"""Demo runs without an API key.

A demo bundle is one real run captured to JSON: every LLM answer (keyed by trace), every
search result (keyed by source, query and limit) and the citation links. Replaying it
runs the real agents and orchestrator; only the LLM and the network are swapped out.

Record a bundle with:  uv run python -m app.demo record "creatine on intelligence vs muscle gain"
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

from .llm import Fixtures, LLMRouter, RecordingClient

BUNDLES = Path(__file__).parent / "demo_bundles"


def _name(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def _skey(source: str, query: str, limit: int) -> str:
    return f"{source}|{query.strip().lower()}|{limit}"


def bundles() -> list[dict]:
    out = []
    for p in sorted(BUNDLES.glob("*.json")):
        try:
            data = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        out.append({"id": p.stem, "text": data.get("text", p.stem), "domain": data.get("domain")})
    return out


class DemoBundle:
    def __init__(self, data: dict[str, Any]):
        self.data = data
        self.text: str = data["text"]
        self.fixtures = Fixtures(BUNDLES / "unused.json", data.setdefault("llm", {}))

    @classmethod
    def load(cls, bundle_id: str) -> "DemoBundle | None":
        path = BUNDLES / f"{_name(bundle_id)}.json"
        if not path.exists():
            return None
        return cls(json.loads(path.read_text()))

    @classmethod
    def match(cls, text: str) -> "DemoBundle | None":
        """The bundle whose question matches this text, if any."""
        return cls.load(_name(text))

    def router(self) -> LLMRouter:
        return LLMRouter.replay(self.fixtures)

    async def search(self, source: str, query: str, limit: int) -> list[dict]:
        rows = self.data.get("search", {}).get(_skey(source, query, limit), [])
        return [{**p, "demo": True} for p in rows]

    async def fulltext(self, paper: dict) -> str:
        return ""

    async def cites(self, papers: list[dict]) -> list[tuple[str, str]]:
        ids = {p["id"] for p in papers}
        return [(a, b) for a, b in self.data.get("cites", []) if a in ids and b in ids]


# ---------------------------------------------------------------- recording


async def record(text: str) -> Path:
    """Run the live pipeline once and save everything it saw."""
    from .agents.intake import IntakeAgent
    from .agents.orchestrator import Run
    from .agents.base import AgentContext
    from .graph import GraphStore
    from .llm import UsageMeter
    from .sources import Sources

    store, sources = GraphStore(), Sources()
    await store.init()
    fx = Fixtures(BUNDLES / f"{_name(text)}.json", {})
    live = LLMRouter.live(None)  # no cache: every call must be recorded
    router = LLMRouter({a: RecordingClient(live.for_agent(a), fx) for a in ("orchestrator", "intake", "discovery",
                                                                           "extractor", "credibility", "stance",
                                                                           "contradictions", "verdict")},
                       RecordingClient(live.for_agent("extractor"), fx), "live")
    search_log: dict[str, list[dict]] = {}
    cite_log: list[list[str]] = []

    async def search(source: str, query: str, limit: int) -> list[dict]:
        rows = await sources.search(source, query, limit)
        search_log[_skey(source, query, limit)] = rows
        return rows

    async def cites(papers: list[dict]) -> list[tuple[str, str]]:
        pairs = await sources.citation_links(papers)
        cite_log.extend([a, b] for a, b in pairs if [a, b] not in cite_log)
        return pairs

    async def ignore(*_):
        return None

    ctx = AgentContext(router, UsageMeter(10**9), ignore)
    out = await IntakeAgent().run(ctx, text)
    if out.intent != "research" or not out.hypotheses:
        raise SystemExit(f"intake refused: {out.intent} {out.message}")
    question = build_question(text, out, demo=True)
    question["fresh"] = True
    run = Run(store, sources, router, question, "live", search=search, cites=cites)

    async def drain():
        while (msg := await run.queue.get()) is not None:
            if msg["event"] in ("agent", "error", "flag"):
                print(msg["event"], json.dumps(msg["data"], default=str)[:160])

    await asyncio.gather(run.execute(), drain())
    fx.data = {"text": text, "domain": out.domain, "llm": fx.data, "search": search_log, "cites": cite_log}
    fx.save()
    await sources.close()
    return fx.path


def build_question(text: str, out: Any, demo: bool = False) -> dict:
    import hashlib

    from .agents.intake import to_hypotheses

    hyps = to_hypotheses(out)
    qid = hashlib.sha1((out.domain + "|" + "|".join(sorted(h["key"] for h in hyps))).encode()).hexdigest()[:10]
    return {"id": ("demo-" if demo else "") + qid, "text": text, "domain": out.domain, "hypotheses": hyps,
            "corrections": out.corrections, "compare": out.compare}


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "record":
        print(asyncio.run(record(sys.argv[2])))
    else:
        print('usage: python -m app.demo record "<question>"')
