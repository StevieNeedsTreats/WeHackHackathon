"""Graph Manager / Orchestrator.

Runs the agents from the design board and streams every step to the client:

  Search/Discovery ─► Structured Extractor ─┐
                  └─► Credibility Enricher ─┼─► Claim Grouper ─► Contradiction Mapper ─► Insights
                  └─► Citation linker ──────┘

Per-paper work fans out in parallel (bounded). Shared memory is the graph plus a
Redis cache inside FalkorDB: fetched pages and extractions are reused across runs
and agents, and in-flight duplicates are coalesced. Progress is written back to the
graph as (:Task) nodes.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from ..config import get_settings
from ..demo import DEMO_CITES, demo_papers
from ..graph import GraphStore
from ..sources import Sources, SourceError, parse_epmc
from . import credibility, extractor
from .contradictions import map_relations
from .insights import NARRATIVE_SYSTEM, build_insights
from .metrics import run_benchmarks

AGENTS = [
    ("discovery", "Search / Discovery", "Query Europe PMC & OpenAlex for papers, trials and reviews"),
    ("extractor", "Structured Extractor", "Trials, participants, methods and +/~/− claims from each abstract"),
    ("credibility", "Credibility Enricher", "Score 0–100 with reasons from metadata only"),
    ("grouper", "Claim Grouper", "Group claims by outcome across papers"),
    ("contradictions", "Contradiction Mapper", "CONTRADICTS edges where direction or magnitude conflict"),
    ("insights", "Insights", "Credibility-weighted consensus, funding and gap analysis"),
    ("orchestrator", "Graph Manager", "Coordinate agents, dedupe work, benchmark multi-hop queries"),
]

EXTRACT_VERSION = "v5"


class Run:
    def __init__(self, store: GraphStore, sources: Sources, substance: str, key: str, mode: str):
        self.store, self.sources = store, sources
        self.substance, self.key, self.mode = substance, key, mode
        self.id = uuid.uuid4().hex[:10]
        self.queue: asyncio.Queue[dict | None] = asyncio.Queue()
        self.settings = get_settings()
        self.t0 = time.perf_counter()
        self.papers: dict[str, dict] = {}
        self.claims: list[dict] = []
        self.cred: dict[str, int] = {}
        self.flags: list[dict] = []
        self.seen_nodes: set[str] = set()
        self.agent_t0: dict[str, float] = {}
        self.engine = "claude" if extractor.llm_available() else "rules"

    # ------------------------------------------------------------------ streaming

    async def emit(self, kind: str, data: Any) -> None:
        await self.queue.put({"event": kind, "data": data, "t": round((time.perf_counter() - self.t0) * 1000)})

    async def agent(self, aid: str, status: str, detail: str = "", done: int | None = None, total: int | None = None) -> None:
        if status == "running" and aid not in self.agent_t0:
            self.agent_t0[aid] = time.perf_counter()
        ms = round((time.perf_counter() - self.agent_t0.get(aid, time.perf_counter())) * 1000)
        await self.emit("agent", {"agent": aid, "status": status, "detail": detail, "done": done, "total": total, "ms": ms})
        if status in {"done", "error"}:
            try:
                await self.store.log_task(self.key, {
                    "id": f"{self.id}:{aid}", "agent": aid, "status": status, "detail": detail[:200], "ms": ms, "run": self.id,
                })
            except Exception:
                pass

    async def node(self, n: dict) -> None:
        if n["id"] in self.seen_nodes:
            await self.emit("update", n)
        else:
            self.seen_nodes.add(n["id"])
            await self.emit("node", n)

    async def edge(self, e: dict) -> None:
        await self.emit("edge", e)

    async def flag(self, target: str, code: str, detail: str) -> None:
        f = {"target": target, "code": code, "detail": detail}
        self.flags.append(f)
        await self.emit("flag", f)

    # ------------------------------------------------------------------ pipeline

    async def execute(self) -> None:
        try:
            await self.emit("run", {
                "id": self.id, "substance": self.substance, "key": self.key, "mode": self.mode,
                "engine": self.engine, "agents": [{"id": a, "name": n, "role": r} for a, n, r in AGENTS],
            })
            await self.agent("orchestrator", "running", "Preparing workspace")
            await self.store.upsert_substance(self.key, self.substance)
            await self.store.reset_substance(self.key)
            await self.node({"id": f"s:{self.key}", "kind": "substance", "name": self.substance, "key": self.key})

            papers = await self.discover()
            if not papers:
                await self.agent("orchestrator", "error", "No papers with abstracts were found")
                await self.emit("error", {"code": "no-papers", "message": f"No papers with abstracts were found for “{self.substance}”. Try a more common name or a synonym."})
                return

            await self.fan_out(papers)
            await self.group()
            contradictions = await self.contradict()
            await self.insight(contradictions)
            await self.benchmark()
            await self.finish(contradictions)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # surface, never crash the stream
            await self.emit("error", {"code": "internal", "message": f"Pipeline stopped: {type(e).__name__}: {e}"[:300]})
        finally:
            await self.queue.put(None)

    async def discover(self) -> list[dict]:
        await self.agent("discovery", "running", "Searching Europe PMC")
        s = self.substance
        if self.mode == "demo":
            papers = demo_papers()
            await asyncio.sleep(0.35)
        else:
            term = f'(TITLE:"{s}") AND HAS_ABSTRACT:y AND SRC:MED'
            queries = [
                (f'{term} AND (PUB_TYPE:"meta-analysis" OR PUB_TYPE:"systematic review")', 6, "meta-analyses"),
                (f'{term} AND PUB_TYPE:"randomized controlled trial"', 10, "randomised trials"),
                (f'{term} AND (ABSTRACT:"adverse" OR ABSTRACT:"safety" OR ABSTRACT:"side effects")', 4, "safety studies"),
            ]
            done = 0

            async def run_q(q: str, size: int, label: str):
                nonlocal done
                try:
                    res = await self.sources.search_epmc(q, size)
                except SourceError as e:
                    await self.flag(f"s:{self.key}", "source-error", f"{label}: {e}")
                    res = []
                done += 1
                await self.agent("discovery", "running", f"{len(res)} {label}", done, len(queries))
                return res

            batches = await asyncio.gather(*(run_q(*q) for q in queries))
            seen, papers = set(), []
            # Interleave so the final set mixes reviews, trials and safety papers.
            for row in _interleave(batches):
                p = parse_epmc(row)
                if p and p["id"] not in seen:
                    seen.add(p["id"])
                    papers.append(p)
            papers = papers[: self.settings.max_papers]

        for p in papers:
            self.papers[p["id"]] = p
            await self.store.upsert_paper(self.key, p)
            await self.emit_paper(p)
            await asyncio.sleep(0.04)
        await self.agent("discovery", "done", f"{len(papers)} papers linked to {s}", len(papers), len(papers))
        return papers

    async def emit_paper(self, p: dict) -> None:
        pid = f"p:{p['id']}"
        await self.node({
            **{k: p.get(k) for k in (
                "id", "pmid", "doi", "title", "label", "year", "journal", "design", "sample_size", "studies",
                "citations", "peer_reviewed", "url", "abstract", "lab", "region", "demo")},
            "paper_id": p["id"], "id": pid, "kind": "paper",
            "funding": sorted({f["type"] for f in p.get("funders", [])}) or ["undisclosed"],
            "first_authors": p.get("authors", [])[:3],
        })
        await self.edge({"id": f"sp:{p['id']}", "source": f"s:{self.key}", "target": pid, "type": "STUDIED_IN"})
        if p.get("authors"):
            a = p["authors"][0]
            await self.node({"id": f"a:{a}", "kind": "author", "name": a})
            await self.edge({"id": f"pa:{p['id']}:{a}", "source": pid, "target": f"a:{a}", "type": "AUTHORED_BY", "position": 0})
        for f in p.get("funders", [])[:2]:
            await self.node({"id": f"f:{f['name']}", "kind": "funder", "name": f["name"], "type": f["type"]})
            await self.edge({"id": f"pf:{p['id']}:{f['name']}", "source": pid, "target": f"f:{f['name']}", "type": "FUNDED_BY"})
        if p.get("lab"):
            await self.node({"id": f"l:{p['lab']}", "kind": "lab", "name": p["lab"], "region": p.get("region") or ""})
            await self.edge({"id": f"pl:{p['id']}", "source": pid, "target": f"l:{p['lab']}", "type": "FROM_LAB"})

    async def fan_out(self, papers: list[dict]) -> None:
        total = len(papers)
        sem = asyncio.Semaphore(self.settings.paper_concurrency)
        counts = {"extracted": 0, "scored": 0}
        await self.agent("credibility", "running", "Scoring papers", 0, total)
        await self.agent("extractor", "running", f"Reading abstracts ({'Claude ' + self.settings.extract_model if self.engine == 'claude' else 'rule engine'})", 0, total)

        async def per_paper(p: dict) -> None:
            async with sem:
                # Credibility (metadata only).
                score, reasons, flags = credibility.score(p)
                self.cred[p["id"]] = score
                await self.store.set_credibility(p["id"], score, reasons, flags)
                await self.node({"id": f"p:{p['id']}", "kind": "paper", "credibility": score, "cred_reasons": reasons, "flags": flags})
                for f in flags:
                    await self.flag(f"p:{p['id']}", f, _FLAG_TEXT.get(f, f))
                counts["scored"] += 1
                await self.agent("credibility", "running", f"{p['label']} → {score}", counts["scored"], total)

                # Extraction, cached per (paper, substance, engine).
                cache_key = f"tg:extract:{EXTRACT_VERSION}:{self.engine}:{self.key}:{p['id']}"
                cached = await self.sources.redis.get(cache_key)
                if cached:
                    claims = json.loads(cached)
                else:
                    claims, _ = await extractor.extract(p, self.substance)
                    await self.sources.redis.set(cache_key, json.dumps(claims), ex=self.settings.cache_ttl_s)
                if self.mode == "demo":
                    await asyncio.sleep(0.12)
                for c in claims:
                    c["id"] = f"{self.key}:{c['id']}"
                    await self.store.add_claim(self.key, c)
                    self.claims.append(c)
                    oid = f"o:{c['outcome_key']}"
                    await self.node({"id": oid, "kind": "outcome", "key": c["outcome_key"], "name": c["outcome"], "category": c["category"]})
                    await self.node({**{k: c.get(k) for k in (
                        "text", "direction", "harm", "effect", "quote", "quote_verified", "paper_id", "outcome", "category", "flags", "extractor")},
                        "claim_id": c["id"], "id": f"c:{c['id']}", "kind": "claim"})
                    await self.edge({"id": f"pc:c:{c['id']}", "source": f"p:{p['id']}", "target": f"c:{c['id']}", "type": "REPORTS"})
                    await self.edge({"id": f"co:c:{c['id']}", "source": f"c:{c['id']}", "target": oid, "type": "ABOUT"})
                    for fl in c["flags"]:
                        await self.flag(f"c:{c['id']}", fl, _FLAG_TEXT.get(fl, fl))
                counts["extracted"] += 1
                await self.agent("extractor", "running", f"{p['label']}: {len(claims)} claim{'s' if len(claims) != 1 else ''}", counts["extracted"], total)

        async def citations() -> None:
            await self.agent("discovery", "running", "Linking citations via OpenAlex")
            try:
                if self.mode == "demo":
                    pairs = DEMO_CITES
                else:
                    pmids = [p["pmid"] for p in papers if p.get("pmid")]
                    links = await self.sources.citation_links(pmids)
                    pairs = [(a, b) for a, b in links if a in self.papers and b in self.papers]
                for a, b in pairs:
                    await self.store.add_cites(a, b)
                    await self.edge({"id": f"cites:{a}:{b}", "source": f"p:{a}", "target": f"p:{b}", "type": "CITES"})
                await self.agent("discovery", "done", f"{len(papers)} papers · {len(pairs)} citation links", len(papers), len(papers))
            except SourceError as e:
                await self.agent("discovery", "done", f"{len(papers)} papers · citations unavailable ({e})")

        await asyncio.gather(citations(), *(per_paper(p) for p in papers))
        await self.agent("credibility", "done", f"Median credibility {sorted(self.cred.values())[len(self.cred) // 2]}", total, total)
        await self.agent("extractor", "done", f"{len(self.claims)} claims from {total} papers", total, total)

    async def group(self) -> None:
        await self.agent("grouper", "running", "Grouping claims by outcome")
        groups: dict[str, dict] = {}
        for c in self.claims:
            g = groups.setdefault(c["outcome_key"], {"positive": 0, "neutral": 0, "null": 0, "papers": set(), "name": c["outcome"], "category": c["category"]})
            g[c["direction"]] += 1
            g["papers"].add(c["paper_id"])
        for k, g in groups.items():
            await self.node({"id": f"o:{k}", "kind": "outcome", "key": k, "name": g["name"], "category": g["category"],
                             "counts": {"positive": g["positive"], "neutral": g["neutral"], "null": g["null"]}, "papers": len(g["papers"])})
        await self.agent("grouper", "done", f"{len(self.claims)} claims → {len(groups)} outcomes")

    async def contradict(self) -> list[dict]:
        await self.agent("contradictions", "running", "Comparing claims on shared outcomes")
        contradictions, supports = map_relations(self.claims, self.cred)
        for s in supports:
            await self.store.add_claim_edge("SUPPORTS", s["a"], s["b"], {})
            await self.edge({"id": f"SUPPORTS:{s['a']}:{s['b']}", "source": f"c:{s['a']}", "target": f"c:{s['b']}", "type": "SUPPORTS"})
        for c in contradictions:
            await self.store.add_claim_edge("CONTRADICTS", c["a"], c["b"], {"reason": c["reason"], "severity": c["severity"]})
            await self.edge({"id": f"CONTRADICTS:{c['a']}:{c['b']}", "source": f"c:{c['a']}", "target": f"c:{c['b']}",
                             "type": "CONTRADICTS", "reason": c["reason"], "severity": c["severity"]})
            if self.mode == "demo":
                await asyncio.sleep(0.08)
        await self.agent("contradictions", "done", f"{len(contradictions)} contradictions · {len(supports)} corroborations")
        return contradictions

    async def insight(self, contradictions: list[dict]) -> None:
        await self.agent("insights", "running", "Weighing evidence by credibility")
        result = build_insights(self.papers, self.claims, self.cred, contradictions)
        await self.emit("insights", result)
        self.insights = result
        if self.engine == "claude" and result["items"]:
            try:
                await self.narrate(result)
            except Exception:
                pass
        await self.agent("insights", "done", f"{len(result['items'])} insights across {len(result['consensus'])} outcomes")

    async def narrate(self, result: dict) -> None:
        facts = json.dumps({"substance": self.substance, "insights": result["items"],
                            "outcomes": [{k: r[k] for k in ("outcome", "verdict", "grade", "papers", "share")} for r in result["consensus"]]})
        client = extractor._anthropic()
        text = ""
        async with client.messages.stream(
            model=self.settings.extract_model, max_tokens=600, output_config={"effort": "low"},
            system=NARRATIVE_SYSTEM, messages=[{"role": "user", "content": facts}],
        ) as stream:
            async for delta in stream.text_stream:
                text += delta
                await self.emit("narrative", {"delta": delta})
        self.insights["narrative"] = text

    async def benchmark(self) -> None:
        await self.agent("orchestrator", "running", "Benchmarking multi-hop queries")
        self.metrics = await run_benchmarks(self.store, self.key)
        await self.emit("metrics", self.metrics)

    async def finish(self, contradictions: list[dict]) -> None:
        dirs = {"positive": 0, "neutral": 0, "null": 0}
        for c in self.claims:
            dirs[c["direction"]] += 1
        counts = await self.store.counts()
        stats = {
            "papers": len(self.papers), "claims": len(self.claims), "directions": dirs,
            "contradictions": len(contradictions), "flags": len(self.flags),
            "elapsed_ms": round((time.perf_counter() - self.t0) * 1000),
            "http_requests": self.sources.stats["requests"], "cache_hits": self.sources.stats["cache_hits"],
            "graph_nodes": counts["nodes"], "graph_edges": counts["edges"], "engine": self.engine, "mode": self.mode,
        }
        await self.store.q(
            "MATCH (s:Substance {key:$k}) SET s.insights=$i, s.metrics=$m, s.stats=$st, s.flags=$f, s.updated=timestamp()",
            {"k": self.key, "i": json.dumps(self.insights), "m": json.dumps(self.metrics), "st": json.dumps(stats), "f": json.dumps(self.flags)},
        )
        await self.agent("orchestrator", "done", f"Graph built in {stats['elapsed_ms'] / 1000:.1f}s")
        await self.emit("done", stats)


_FLAG_TEXT = {
    "small-sample": "Fewer than 30 participants",
    "sample-unreported": "Sample size not stated in abstract",
    "preprint": "Not peer reviewed (preprint)",
    "industry-funded": "Industry funding disclosed",
    "funding-undisclosed": "No funder listed",
    "animal-study": "Animal study — may not translate to humans",
    "retracted": "Publication retracted",
    "low-credibility": "Credibility below 45",
    "unverified-quote": "Supporting quote not found verbatim in abstract",
    "no-effect-size": "Positive claim without a reported effect size",
}


def _interleave(batches: list[list[dict]]) -> list[dict]:
    out = []
    for i in range(max((len(b) for b in batches), default=0)):
        for b in batches:
            if i < len(b):
                out.append(b[i])
    return out
