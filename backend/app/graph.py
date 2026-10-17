"""FalkorDB access layer.

Data model (one shared graph, so papers, findings and people are reused across questions):

  (:Question)-[:ASKS]->(:Hypothesis)-[:SUBJECT|OUTCOME|POPULATION]->(:Concept)
  (:Hypothesis)-[:CONSIDERED {relevance, slice}]->(:Paper)
  (:Paper)-[:DESCRIBES]->(:Study)-[:FOUND]->(:Finding)-[:MEASURES]->(:Concept)
  (:Finding)-[:EVIDENCE_FOR {stance, weight, rationale}]->(:Hypothesis)
  (:Finding)-[:IN_CLUSTER]->(:Cluster)-[:OF]->(:Hypothesis)
  (:Finding)-[:CONTRADICTS {hypothesis, reason, severity, explained_by}]->(:Finding)
  (:Paper)-[:AUTHORED_BY {pos}]->(:Author)  (:Paper)-[:AFFILIATED]->(:Lab)  (:Paper)-[:FUNDED_BY]->(:Funder)
  (:Paper)-[:CITES]->(:Paper)               (:Paper)-[:SAME_AS]->(:Paper)

Efficiency rules (FalkorDB docs):
  * every write is one parameterised UNWIND batch with a constant query string, so the
    plan cache (CACHE_SIZE) is hit and round trips stay few;
  * every MERGE key has a unique constraint (backed by its exact-match index);
  * repeated low-cardinality strings are stored with intern();
  * big text (abstracts, insights, run logs) lives beside the graph, not in it: plain Redis
    locally, or a separate key-value graph on FalkorDB Cloud (see kv.py).
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
from typing import Any

from falkordb.asyncio import FalkorDB
from falkordb.edge import Edge
from falkordb.node import Node
from falkordb.path import Path

from .config import get_settings

UNIQUE = [
    ("Question", "id"), ("Hypothesis", "key"), ("Concept", "id"), ("Paper", "id"), ("Study", "id"),
    ("Finding", "id"), ("Cluster", "id"), ("Author", "id"), ("Lab", "id"), ("Funder", "id"),
]
RANGE = [("Paper", "doi"), ("Paper", "pmid"), ("Paper", "title_norm"), ("Cluster", "hypothesis")]
FULLTEXT = [("Concept", "name"), ("Paper", "title")]


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80]


def title_norm(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", title or "").lower()).strip()[:200]


class GraphStore:
    def __init__(self) -> None:
        s = get_settings()
        self.db = FalkorDB(**s.db_conn())
        self.graph = self.db.select_graph(s.graph_name)
        self.settings = s

    async def init(self) -> None:
        """Indexes and constraints. Each is idempotent: 'already exists' is fine."""
        await self.graph.query("RETURN 1")  # creates the graph key if missing
        for label, prop in UNIQUE + RANGE:
            try:
                await self.graph.create_node_range_index(label, prop)
            except Exception:
                pass
        for label, prop in UNIQUE:
            try:
                await self.graph.create_node_unique_constraint(label, prop)
            except Exception:
                pass
        try:  # relationship range index: contradictions are scoped by hypothesis
            await self.graph.query("CREATE INDEX FOR ()-[r:CONTRADICTS]-() ON (r.hypothesis)")
        except Exception:
            pass
        for label, prop in FULLTEXT:
            try:
                await self.graph.create_node_fulltext_index(label, prop)
            except Exception:
                pass

    async def ping(self) -> bool:
        try:
            await self.graph.ro_query("RETURN 1")
            return True
        except Exception:
            return False

    async def q(self, query: str, params: dict | None = None):
        return await self.graph.query(query, params or {})

    async def ro(self, query: str, params: dict | None = None, timeout: int | None = None):
        return await self.graph.ro_query(query, params or {}, timeout=timeout or self.settings.query_timeout_ms)

    # ================================================================== writes

    async def upsert_question(self, qid: str, text: str, domain: str) -> None:
        await self.q(
            "MERGE (q:Question {id:$id}) SET q.text=$text, q.domain=intern($domain), q.created=timestamp()",
            {"id": qid, "text": text, "domain": domain},
        )

    async def upsert_hypotheses(self, qid: str, hyps: list[dict]) -> None:
        """hyps: {key, statement, domain, relation, subject, outcome, population?} (concepts as {id,name})."""
        await self.q(
            """
            MATCH (q:Question {id:$qid})
            UNWIND $hs AS h
            MERGE (x:Hypothesis {key:h.key})
              ON CREATE SET x.created=timestamp()
            SET x.statement=h.statement, x.domain=intern(h.domain), x.relation=intern(h.relation)
            MERGE (q)-[:ASKS]->(x)
            """,
            {"qid": qid, "hs": hyps},
        )
        roles = [
            {"key": h["key"], "id": h[role]["id"], "name": h[role]["name"], "kind": role}
            for h in hyps for role in ("subject", "outcome", "population") if h.get(role)
        ]
        for rel in ("SUBJECT", "OUTCOME", "POPULATION"):
            rows = [r for r in roles if r["kind"] == rel.lower()]
            if not rows:
                continue
            await self.q(
                f"""
                UNWIND $rows AS r
                MATCH (h:Hypothesis {{key:r.key}})
                MERGE (c:Concept {{id:r.id}}) ON CREATE SET c.name=r.name, c.kind=intern(r.kind)
                MERGE (h)-[:{rel}]->(c)
                """,
                {"rows": rows},
            )

    async def find_hypothesis(self, key: str) -> dict | None:
        res = await self.ro("MATCH (h:Hypothesis {key:$k}) RETURN h", {"k": key})
        return dict(res.result_set[0][0].properties) if res.result_set else None

    async def resolve_papers(self, papers: list[dict]) -> dict[str, str]:
        """Map candidate ids to ids already in the graph (same DOI, PMID or title)."""
        rows = [{"cid": p["id"], "doi": p.get("doi"), "pmid": p.get("pmid"), "tn": title_norm(p.get("title", ""))}
                for p in papers]
        res = await self.ro(
            """
            UNWIND $rows AS r
            OPTIONAL MATCH (a:Paper {doi:r.doi})
            OPTIONAL MATCH (b:Paper {pmid:r.pmid})
            OPTIONAL MATCH (c:Paper {title_norm:r.tn})
            RETURN r.cid, coalesce(a.id, b.id, c.id)
            """,
            {"rows": rows},
        )
        return {cid: found for cid, found in res.result_set if found and found != cid}

    async def upsert_papers(self, hyp_key: str, papers: list[dict]) -> None:
        """One batch per entity type: papers + CONSIDERED, then authors, labs, funders."""
        rows = []
        for p in papers:
            props = {k: p.get(k) for k in ("title", "label", "year", "journal", "doi", "pmid", "url", "citations",
                                            "peer_reviewed", "retracted", "kind", "venue_type", "demo")
                     if p.get(k) is not None}
            props["title_norm"] = title_norm(p.get("title", ""))
            rows.append({"id": p["id"], "props": props, "design": p.get("design") or "Other",
                         "rel": float(p.get("relevance") or 0), "slice": p.get("slice") or "", "n": p.get("sample_size")})
        await self.q(
            """
            MATCH (h:Hypothesis {key:$hk})
            UNWIND $rows AS r
            MERGE (p:Paper {id:r.id})
            SET p += r.props, p.design = coalesce(p.design, intern(r.design)), p.n = coalesce(p.n, r.n)
            MERGE (h)-[c:CONSIDERED]->(p)
            SET c.relevance=r.rel, c.slice=intern(r.slice)
            """,
            {"hk": hyp_key, "rows": rows},
        )
        authors = [{"pid": p["id"], "id": a["id"], "name": a["name"], "pos": i}
                   for p in papers for i, a in enumerate(p.get("authors", [])[:3])]
        labs = [{"pid": p["id"], "id": l["id"], "name": l["name"], "country": l.get("country") or ""}
                for p in papers for l in p.get("labs", [])[:2]]
        funders = [{"pid": p["id"], "id": f["id"], "name": f["name"], "type": f.get("type") or "other"}
                   for p in papers for f in p.get("funders", [])[:3]]
        if authors:
            await self.q(
                """
                UNWIND $rows AS r
                MATCH (p:Paper {id:r.pid})
                MERGE (a:Author {id:r.id}) ON CREATE SET a.name=r.name
                MERGE (p)-[e:AUTHORED_BY]->(a) SET e.pos=r.pos
                """,
                {"rows": authors},
            )
        if labs:
            await self.q(
                """
                UNWIND $rows AS r
                MATCH (p:Paper {id:r.pid})
                MERGE (l:Lab {id:r.id}) ON CREATE SET l.name=r.name, l.country=intern(r.country)
                MERGE (p)-[:AFFILIATED]->(l)
                """,
                {"rows": labs},
            )
        if funders:
            await self.q(
                """
                UNWIND $rows AS r
                MATCH (p:Paper {id:r.pid})
                MERGE (f:Funder {id:r.id}) ON CREATE SET f.name=r.name
                SET f.type=intern(r.type)
                MERGE (p)-[:FUNDED_BY]->(f)
                """,
                {"rows": funders},
            )

    async def add_same_as(self, pairs: list[tuple[str, str]]) -> None:
        if pairs:
            await self.q(
                "UNWIND $rows AS r MATCH (a:Paper {id:r[0]}), (b:Paper {id:r[1]}) MERGE (a)-[:SAME_AS]->(b)",
                {"rows": [list(p) for p in pairs]},
            )

    async def add_cites(self, pairs: list[tuple[str, str]]) -> None:
        if pairs:
            await self.q(
                "UNWIND $rows AS r MATCH (a:Paper {id:r[0]}), (b:Paper {id:r[1]}) MERGE (a)-[:CITES]->(b)",
                {"rows": [list(p) for p in pairs]},
            )

    async def write_extraction(self, paper_id: str, design: str | None, n: int | None,
                               studies: list[dict], findings: list[dict]) -> None:
        """studies: {id, props}; findings: {id, study_id, outcome:{id,name}, props}."""
        await self.q(
            """
            MATCH (p:Paper {id:$pid})
            SET p.design = intern(coalesce($design, p.design)), p.n = coalesce($n, p.n), p.extracted = true
            WITH p
            UNWIND $studies AS s
            MERGE (st:Study {id:s.id}) SET st += s.props, st.design = intern(s.design)
            MERGE (p)-[:DESCRIBES]->(st)
            """,
            {"pid": paper_id, "design": design, "n": n, "studies": studies},
        )
        if findings:
            await self.q(
                """
                UNWIND $rows AS r
                MATCH (st:Study {id:r.study_id})
                MERGE (f:Finding {id:r.id})
                SET f += r.props, f.direction = intern(r.direction), f.effect_unit = intern(r.unit)
                MERGE (st)-[:FOUND]->(f)
                MERGE (c:Concept {id:r.outcome.id}) ON CREATE SET c.name=r.outcome.name, c.kind=intern('outcome')
                MERGE (f)-[:MEASURES]->(c)
                """,
                {"rows": findings},
            )

    async def set_credibility(self, rows: list[dict]) -> None:
        """rows: {id, score, reasons(json str), flags}."""
        await self.q(
            "UNWIND $rows AS r MATCH (p:Paper {id:r.id}) SET p.credibility=r.score, p.cred_reasons=r.reasons, p.flags=r.flags",
            {"rows": rows},
        )

    async def reset_hypothesis(self, key: str) -> None:
        """Clear one hypothesis's judgements (not the papers or findings, which are shared)."""
        await self.q("MATCH (:Hypothesis {key:$k})<-[e:EVIDENCE_FOR]-() DELETE e", {"k": key})
        await self.q("MATCH (c:Cluster {hypothesis:$k}) DETACH DELETE c", {"k": key})
        await self.q("MATCH ()-[r:CONTRADICTS {hypothesis:$k}]->() DELETE r", {"k": key})
        await self.q("MATCH (h:Hypothesis {key:$k})-[c:CONSIDERED]->() DELETE c", {"k": key})
        await self.q("MATCH (h:Hypothesis {key:$k}) REMOVE h.verdict, h.grade, h.share_support, h.share_refute, h.share_mixed",
                     {"k": key})

    async def delete_question(self, qid: str) -> list[str]:
        """Delete a question and the hypotheses only it asks. Papers, studies and findings are
        shared across questions, so they stay. Returns the keys of the deleted hypotheses."""
        res = await self.ro(
            """
            MATCH (:Question {id:$id})-[:ASKS]->(h:Hypothesis)
            MATCH (o:Question)-[:ASKS]->(h)
            WITH h, count(o) AS askers
            WHERE askers = 1
            RETURN h.key
            """,
            {"id": qid},
        )
        keys = [r[0] for r in res.result_set]
        for key in keys:
            await self.reset_hypothesis(key)
        if keys:
            await self.q("UNWIND $ks AS k MATCH (h:Hypothesis {key:k}) DETACH DELETE h", {"ks": keys})
        await self.q("MATCH (q:Question {id:$id}) DETACH DELETE q", {"id": qid})
        return keys

    async def write_stances(self, key: str, stances: list[dict], clusters: list[dict]) -> None:
        """stances: {finding_id, stance, weight, rationale}; clusters: {id, label, context, findings[]}."""
        await self.q("MATCH (:Hypothesis {key:$k})<-[e:EVIDENCE_FOR]-() DELETE e", {"k": key})
        await self.q("MATCH (c:Cluster {hypothesis:$k}) DETACH DELETE c", {"k": key})
        if stances:
            await self.q(
                """
                MATCH (h:Hypothesis {key:$k})
                UNWIND $rows AS r
                MATCH (f:Finding {id:r.finding_id})
                MERGE (f)-[e:EVIDENCE_FOR]->(h)
                SET e.stance=intern(r.stance), e.weight=r.weight, e.rationale=r.rationale
                """,
                {"k": key, "rows": stances},
            )
        if clusters:
            await self.q(
                """
                MATCH (h:Hypothesis {key:$k})
                UNWIND $rows AS r
                MERGE (c:Cluster {id:r.id}) SET c.label=r.label, c.context=r.context, c.hypothesis=$k
                MERGE (c)-[:OF]->(h)
                WITH c, r
                UNWIND r.findings AS fid
                MATCH (f:Finding {id:fid})
                MERGE (f)-[:IN_CLUSTER]->(c)
                """,
                {"k": key, "rows": clusters},
            )

    async def write_contradictions(self, key: str, rows: list[dict]) -> None:
        """rows: {a, b, reason, severity, explained_by}."""
        if rows:
            await self.q(
                """
                UNWIND $rows AS r
                MATCH (a:Finding {id:r.a}), (b:Finding {id:r.b})
                MERGE (a)-[e:CONTRADICTS {hypothesis:$k}]->(b)
                SET e.reason=intern(r.reason), e.severity=intern(r.severity), e.explained_by=r.explained_by
                """,
                {"k": key, "rows": rows},
            )

    async def set_verdict(self, key: str, verdict: dict) -> None:
        await self.q(
            """
            MATCH (h:Hypothesis {key:$k})
            SET h.verdict=intern($v.verdict), h.grade=intern($v.grade), h.share_support=$v.support,
                h.share_refute=$v.refute, h.share_mixed=$v.mixed, h.papers=$v.papers, h.updated=timestamp()
            """,
            {"k": key, "v": verdict},
        )

    # ================================================================== reads

    async def questions(self, limit: int = 30) -> list[dict]:
        res = await self.ro(
            """
            MATCH (q:Question)-[:ASKS]->(h:Hypothesis)
            WITH q, collect({key:h.key, statement:h.statement, verdict:h.verdict, grade:h.grade}) AS hs
            RETURN q.id, q.text, q.domain, q.created, hs
            ORDER BY q.created DESC LIMIT $n
            """,
            {"n": limit},
        )
        return [{"id": r[0], "text": r[1], "domain": r[2], "created": r[3], "hypotheses": r[4]} for r in res.result_set]

    async def hypotheses_of(self, qid: str) -> list[dict]:
        res = await self.ro(
            """
            MATCH (q:Question {id:$id})-[:ASKS]->(h:Hypothesis)
            OPTIONAL MATCH (h)-[r:SUBJECT|OUTCOME|POPULATION]->(c:Concept)
            RETURN h, collect([type(r), c.id, c.name])
            """,
            {"id": qid},
        )
        out = []
        for h, roles in res.result_set:
            d = dict(h.properties)
            for rel, cid, name in roles:
                if rel:
                    d[rel.lower()] = {"id": cid, "name": name}
            out.append(d)
        return out

    async def snapshot(self, qid: str) -> dict:
        """Everything the canvas needs for one question."""
        t0 = time.perf_counter()
        qres = await self.ro("MATCH (q:Question {id:$id}) RETURN q", {"id": qid})
        if not qres.result_set:
            return {"question": None, "hypotheses": [], "papers": [], "findings": [], "contradictions": [], "cites": []}
        question = dict(qres.result_set[0][0].properties)
        hyps = await self.hypotheses_of(qid)

        papers_res = await self.ro(
            """
            MATCH (:Question {id:$id})-[:ASKS]->(h:Hypothesis)-[c:CONSIDERED]->(p:Paper)
            RETURN h.key, c.relevance, c.slice, p,
                   [(p)-[ra:AUTHORED_BY]->(a:Author) | [a.id, a.name, ra.pos]],
                   [(p)-[:FUNDED_BY]->(f:Funder) | [f.id, f.name, f.type]],
                   [(p)-[:AFFILIATED]->(l:Lab) | [l.id, l.name, l.country]]
            """,
            {"id": qid},
        )
        papers: dict[str, dict] = {}
        for hk, rel, sl, p, authors, funders, labs in papers_res.result_set:
            d = papers.get(p.properties["id"])
            if d is None:
                d = _paper_props(p)
                d["authors"] = sorted([{"id": a, "name": n, "pos": pos} for a, n, pos in authors if a], key=lambda x: x["pos"] or 0)
                d["funders"] = [{"id": a, "name": n, "type": t} for a, n, t in funders if a]
                d["labs"] = [{"id": a, "name": n, "country": c} for a, n, c in labs if a]
                d["considered"] = {}
                papers[d["id"]] = d
            d["considered"][hk] = {"relevance": rel, "slice": sl}

        fres = await self.ro(
            """
            MATCH (:Question {id:$id})-[:ASKS]->(h:Hypothesis)<-[e:EVIDENCE_FOR]-(f:Finding)<-[:FOUND]-(s:Study)<-[:DESCRIBES]-(p:Paper)
            OPTIONAL MATCH (f)-[:MEASURES]->(o:Concept)
            OPTIONAL MATCH (f)-[:IN_CLUSTER]->(cl:Cluster {hypothesis:h.key})
            RETURN h.key, e.stance, e.weight, e.rationale, f, s, p.id, o.id, o.name, cl.id, cl.label, cl.context
            """,
            {"id": qid},
        )
        findings: dict[str, dict] = {}
        studies: dict[str, dict] = {}
        clusters: dict[str, dict] = {}
        for hk, stance, weight, rationale, f, s, pid, oid, oname, clid, cllabel, clctx in fres.result_set:
            fd = findings.get(f.properties["id"])
            if fd is None:
                fd = {**f.properties, "paper_id": pid, "study_id": s.properties["id"],
                      "outcome": {"id": oid, "name": oname}, "evidence": {}}
                findings[fd["id"]] = fd
            fd["evidence"][hk] = {"stance": stance, "weight": weight, "rationale": rationale, "cluster": clid}
            studies[s.properties["id"]] = {**s.properties, "paper_id": pid}
            if clid:
                cl = clusters.setdefault(clid, {"id": clid, "label": cllabel, "context": clctx, "hypothesis": hk, "findings": []})
                cl["findings"].append(fd["id"])

        cres = await self.ro(
            """
            MATCH (:Question {id:$id})-[:ASKS]->(h:Hypothesis)<-[:EVIDENCE_FOR]-(a:Finding)-[r:CONTRADICTS]->(b:Finding)
            WHERE r.hypothesis = h.key
            RETURN DISTINCT h.key, a.id, b.id, r.reason, r.severity, r.explained_by
            """,
            {"id": qid},
        )
        contradictions = [{"hypothesis": h, "a": a, "b": b, "reason": r, "severity": s, "explained_by": e}
                          for h, a, b, r, s, e in cres.result_set]

        ids = list(papers)
        cites = await self.ro(
            "MATCH (a:Paper)-[r:CITES]->(b:Paper) WHERE a.id IN $ids AND b.id IN $ids RETURN a.id, b.id",
            {"ids": ids},
        )
        return {
            "question": question, "hypotheses": hyps, "papers": list(papers.values()), "studies": list(studies.values()),
            "findings": list(findings.values()), "clusters": list(clusters.values()), "contradictions": contradictions,
            "cites": [list(r) for r in cites.result_set], "ms": round((time.perf_counter() - t0) * 1000, 1),
        }

    async def counts(self) -> dict:
        res = await self.ro("MATCH (n) RETURN count(n)")
        rel = await self.ro("MATCH ()-[r]->() RETURN count(r)")
        return {"nodes": res.result_set[0][0], "edges": rel.result_set[0][0]}


def _paper_props(n: Node) -> dict[str, Any]:
    d = dict(n.properties)
    d.pop("title_norm", None)
    if isinstance(d.get("cred_reasons"), str):
        try:
            d["cred_reasons"] = json.loads(d["cred_reasons"])
        except ValueError:
            d["cred_reasons"] = []
    return d


def to_jsonable(v: Any) -> Any:
    """Convert FalkorDB result values for the read-only console."""
    if isinstance(v, Node):
        return {"_type": "node", "labels": list(v.labels or []), **_paper_props(v)}
    if isinstance(v, Edge):
        return {"_type": "edge", "relation": v.relation, **(v.properties or {})}
    if isinstance(v, Path):
        return {"_type": "path", "nodes": [to_jsonable(n) for n in v.nodes()], "edges": [to_jsonable(e) for e in v.edges()]}
    if isinstance(v, list):
        return [to_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: to_jsonable(x) for k, x in v.items()}
    return v
