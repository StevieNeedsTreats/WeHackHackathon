"""Verdict agent: grades one hypothesis and explains why.

The numbers (credibility-weighted shares, A–D grade, verdict label) are computed in code
from the graph, so they are reproducible. The LLM writes the insights, gaps and the
plain-language summary, and may run read-only graph queries to check multi-hop facts
such as who funded each side.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Awaitable, Callable, Literal

from pydantic import BaseModel, Field

from ..domains import DomainPack
from ..llm import ToolSpec, ToolsUnsupported
from .base import Agent, AgentContext

GRAPH_SCHEMA = """(:Hypothesis {key})<-[:EVIDENCE_FOR {stance, weight}]-(:Finding {text, direction, effect_value, harm})
(:Finding)<-[:FOUND]-(:Study {design, n, population})<-[:DESCRIBES]-(:Paper {id, label, year, credibility, design})
(:Paper)-[:FUNDED_BY]->(:Funder {name, type})   (:Paper)-[:AFFILIATED]->(:Lab {name, country})
(:Paper)-[:AUTHORED_BY]->(:Author {name})       (:Paper)-[:CITES]->(:Paper)
(:Finding)-[:CONTRADICTS {hypothesis, reason, severity}]->(:Finding)   (:Finding)-[:IN_CLUSTER]->(:Cluster {label})
Use $k for the hypothesis key."""


class InsightOut(BaseModel):
    kind: Literal["headline", "finding", "safety", "conflict", "funding", "gap", "quality"]
    title: str = Field(description="At most 8 words")
    body: str = Field(description="One or two sentences with numbers from the facts")
    tone: Literal["support", "refute", "mixed", "neutral"]
    refs: list[str] = Field(default_factory=list, description="Finding refs (F#) this rests on")


class VerdictOut(BaseModel):
    summary: str = Field(description="Three plain-English sentences for a general reader")
    insights: list[InsightOut] = Field(default_factory=list, max_length=6)
    gaps: list[str] = Field(default_factory=list, max_length=4, description="What evidence is missing")


SYSTEM = """You write the verdict page for one hypothesis from computed evidence facts. Use only the facts \
given and what your graph queries return; never invent studies or numbers. The verdict label and grade are \
already decided; explain them. Point out contradictions, funding patterns and gaps (e.g. no studies in the \
asked population). No advice, no dosing, no preamble."""


def consensus(rows: list[dict], domain: DomainPack) -> dict[str, Any]:
    """rows: relevant findings with stance, weight, design, paper_id, cluster."""
    w = {"supports": 0.0, "refutes": 0.0, "mixed": 0.0}
    for r in rows:
        w[r["stance"]] += r["weight"]
    total = sum(w.values())
    share = {k: (v / total if total else 0.0) for k, v in w.items()}
    papers = {r["paper_id"] for r in rows}
    best = max((domain.designs.get(r["design"], 0) for r in rows), default=0)
    top = sorted(domain.designs.values(), reverse=True)
    dominant = max(share.values()) if total else 0
    if best >= top[1] and len(papers) >= 2 and dominant >= 0.7:
        grade = "A"
    elif best >= top[2] and len(papers) >= 2 and dominant >= 0.6:
        grade = "B"
    elif len(papers) >= 2 or best >= top[2]:
        grade = "C"
    else:
        grade = "D"
    single_review = len(papers) == 1 and best >= top[1]
    if total < 0.5 or (len(papers) < 2 and not single_review):
        verdict, tone = "Insufficient evidence", "neutral"
    elif share["supports"] >= 0.7:
        verdict, tone = "Supported", "support"
    elif share["refutes"] >= 0.6:
        verdict, tone = "Refuted", "refute"
    else:
        verdict, tone = "Contested", "mixed"
    clusters: dict[str, dict] = defaultdict(lambda: {"supports": 0.0, "refutes": 0.0, "mixed": 0.0, "n": 0})
    for r in rows:
        if r.get("cluster"):
            c = clusters[r["cluster"]]
            c[r["stance"]] += r["weight"]
            c["n"] += 1
    return {
        "verdict": verdict, "tone": tone, "grade": grade, "papers": len(papers), "findings": len(rows),
        "weight": round(total, 2), "support": round(share["supports"], 3), "refute": round(share["refutes"], 3),
        "mixed": round(share["mixed"], 3), "best_design": next((k for k, v in domain.designs.items() if v == best), None),
        "clusters": {k: {**v, "supports": round(v["supports"], 2), "refutes": round(v["refutes"], 2),
                         "mixed": round(v["mixed"], 2)} for k, v in clusters.items()},
    }


class VerdictAgent(Agent):
    name = "verdict"
    system = SYSTEM
    max_steps = 5
    max_tokens = 4000

    async def run(self, ctx: AgentContext, hyp: dict, facts: dict, finding_lines: list[str], domain: DomainPack,
                  query: Callable[[str], Awaitable[Any]]) -> VerdictOut:
        tool = ToolSpec(
            "graph_query",
            "Run a read-only Cypher query on the evidence graph. Returns up to 30 rows.\n" + GRAPH_SCHEMA,
            {"type": "object", "properties": {"cypher": {"type": "string"}}, "required": ["cypher"]},
            lambda a: query(str(a.get("cypher", ""))),
        )
        prompt = (
            f"Hypothesis: {hyp['statement']}\nDomain: {domain.name}. {domain.verdict_notes}\n\n"
            f"Computed facts:\n{json.dumps(facts, indent=1)}\n\nFindings:\n" + "\n".join(finding_lines[:80]) +
            "\n\nOptionally query the graph (at most 2 queries), then submit the verdict page."
        )
        try:
            return await self.loop(ctx, prompt, VerdictOut, [tool], trace=f"verdict:{hyp['key']}", tag=hyp["key"])
        except ToolsUnsupported:
            # Providers without tool calls still get a verdict page, just without graph queries.
            return await self.ask(ctx, prompt.rsplit("\n\n", 1)[0] + "\n\nWrite the verdict page.", VerdictOut,
                                  trace=f"verdict:{hyp['key']}:plain")
