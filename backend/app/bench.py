"""Before/after benchmark for the data model optimizations.

Builds a synthetic graph shaped like TruthGraph's (20 questions × 3 hypotheses × 40
papers, each with 3 authors, 3 funders, 2 labs, one study and 3 findings) in a separate
graph, then times the queries that changed against their previous versions and checks
both return the same rows. The graph is deleted afterwards.

    cd backend && uv run python -m app.bench          # needs FalkorDB, as configured by TG_*
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import statistics
import time

os.environ.setdefault("TG_GRAPH_NAME", "truthgraph_bench")

from .agents.metrics import QUERIES  # noqa: E402
from .graph import GraphStore, slug  # noqa: E402

QUESTIONS, HYPS, PAPERS, FINDINGS = 20, 3, 40, 3
REPEATS = 40

# The queries as they were before the optimizations.
BEFORE = {
    "snapshot-papers": """
MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)-[c:CONSIDERED]->(p:Paper)
OPTIONAL MATCH (p)-[ra:AUTHORED_BY]->(a:Author)
OPTIONAL MATCH (p)-[:FUNDED_BY]->(f:Funder)
OPTIONAL MATCH (p)-[:AFFILIATED]->(l:Lab)
RETURN h.key, c.relevance, c.slice, p,
       collect(DISTINCT [a.id, a.name, ra.pos]), collect(DISTINCT [f.id, f.name, f.type]),
       collect(DISTINCT [l.id, l.name, l.country])""",
    "funding-trail": """
MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)<-[e:EVIDENCE_FOR]-(:Finding)<-[:FOUND]-(:Study)<-[:DESCRIBES]-(p:Paper)
OPTIONAL MATCH (p)-[:FUNDED_BY]->(f:Funder)
RETURN h.statement AS hypothesis, coalesce(f.type, 'undisclosed') AS funder_type, e.stance AS stance,
       count(DISTINCT p) AS papers
ORDER BY hypothesis, papers DESC""",
    "who-contradicts-whom": """
MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)
MATCH (a:Finding)-[c:CONTRADICTS]->(b:Finding) WHERE c.hypothesis = h.key
MATCH (a)<-[:FOUND]-(:Study)<-[:DESCRIBES]-(pa:Paper), (b)<-[:FOUND]-(:Study)<-[:DESCRIBES]-(pb:Paper)
OPTIONAL MATCH (pa)-[:AFFILIATED]->(la:Lab)
OPTIONAL MATCH (pb)-[:AFFILIATED]->(lb:Lab)
RETURN pa.label AS paper_a, la.name AS lab_a, pb.label AS paper_b, lb.name AS lab_b, c.reason AS reason,
       c.explained_by AS explained_by
LIMIT 25""",
}
AFTER = {
    "snapshot-papers": """
MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)-[c:CONSIDERED]->(p:Paper)
RETURN h.key, c.relevance, c.slice, p,
       [(p)-[ra:AUTHORED_BY]->(a:Author) | [a.id, a.name, ra.pos]],
       [(p)-[:FUNDED_BY]->(f:Funder) | [f.id, f.name, f.type]],
       [(p)-[:AFFILIATED]->(l:Lab) | [l.id, l.name, l.country]]""",
    **{q["id"]: q["cypher"] for q in QUERIES if q["id"] in ("funding-trail", "who-contradicts-whom")},
}
RAW_ROWS = """
MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)-[c:CONSIDERED]->(p:Paper)
OPTIONAL MATCH (p)-[ra:AUTHORED_BY]->(a:Author)
OPTIONAL MATCH (p)-[:FUNDED_BY]->(f:Funder)
OPTIONAL MATCH (p)-[:AFFILIATED]->(l:Lab)
RETURN count(*)"""


async def build(s: GraphStore) -> None:
    rnd = random.Random(7)
    outcomes = [f"outcome {i}" for i in range(400)]
    pid = 0
    for qi in range(QUESTIONS):
        qid = f"q{qi}"
        await s.upsert_question(qid, f"question {qi}", "medical")
        hyps = []
        for hi in range(HYPS):
            out = rnd.choice(outcomes)
            hyps.append({"key": f"{qid}h{hi}", "statement": f"Hypothesis {qi}.{hi}", "domain": "medical",
                         "relation": "increases", "population": None,
                         "subject": {"id": f"subject-{qi}", "name": f"Subject {qi}", "synonyms": []},
                         "outcome": {"id": slug(out), "name": out, "synonyms": [f"{out} alt"]}})
        await s.upsert_hypotheses(qid, hyps)
        for h in hyps:
            papers = []
            for _ in range(PAPERS):
                papers.append({
                    "id": f"P{pid}", "title": f"Paper {pid}", "label": f"P{pid}",
                    "authors": [{"id": f"a{rnd.randrange(3000)}", "name": "Author"} for _ in range(3)],
                    "funders": [{"id": f"f{rnd.randrange(200)}", "name": "Funder",
                                 "type": rnd.choice(["industry", "public"])} for _ in range(3)],
                    "labs": [{"id": f"l{rnd.randrange(300)}", "name": "Lab"} for _ in range(2)],
                })
                pid += 1
            await s.upsert_papers(h["key"], papers)
            fids = []
            for p in papers:
                sid = f"{p['id']}#s0"
                rows = []
                for j in range(FINDINGS):
                    out = rnd.choice(outcomes)
                    rows.append({"id": f"{sid}f{j}", "study_id": sid, "direction": "increase", "unit": "kg",
                                 "outcome": {"id": slug(out), "name": out}, "props": {"text": out}})
                    fids.append(rows[-1]["id"])
                await s.write_extraction(p["id"], "RCT", 50, [{"id": sid, "design": "RCT", "props": {}}], rows)
            stances = [{"finding_id": f, "stance": rnd.choice(["supports", "refutes", "mixed"]), "weight": 0.5,
                        "rationale": "r", "same_outcome": rnd.random() < 0.33} for f in fids]
            await s.write_stances(h["key"], stances,
                                  [{"id": f"{h['key']}:c0", "label": "c", "context": "c", "findings": fids[:20]}])
            pairs = rnd.sample(fids, 20)
            await s.write_contradictions(h["key"], [{"a": pairs[i], "b": pairs[i + 1], "reason": "dose",
                                                     "severity": "low", "explained_by": "dose"} for i in range(0, 20, 2)])


async def timed(fn, n: int = REPEATS) -> tuple[float, float]:
    ts = []
    for _ in range(n):
        t0 = time.perf_counter()
        await fn()
        ts.append((time.perf_counter() - t0) * 1000)
    ts.sort()
    return round(statistics.median(ts), 2), round(ts[int(len(ts) * 0.95) - 1], 2)


async def main() -> None:
    s = GraphStore()
    if s.settings.graph_name == "truthgraph":
        raise SystemExit("Refusing to benchmark in the main graph; set TG_GRAPH_NAME to a scratch graph.")
    await s.graph.query("RETURN 1")
    await s.graph.delete()
    await s.init()
    await build(s)
    size = await s.counts()
    params = {"q": "q7"}
    out = {"graph": size, "repeats": REPEATS, "queries": {}, "writes": {}}

    for qid in BEFORE:
        old, new = BEFORE[qid], AFTER[qid]
        a, b = await s.ro(old, params), await s.ro(new, params)
        same = sorted(map(str, a.result_set)) == sorted(map(str, b.result_set)) if qid != "snapshot-papers" else None
        before = await timed(lambda: s.ro(old, params))
        after = await timed(lambda: s.ro(new, params))
        out["queries"][qid] = {"before_ms": before[0], "before_p95": before[1], "after_ms": after[0],
                               "after_p95": after[1], "rows": len(b.result_set), "same_rows": same}
    out["queries"]["snapshot-papers"]["raw_rows_before"] = (await s.ro(RAW_ROWS, params)).result_set[0][0]

    key = "q7h0"
    fids = [r[0] for r in (await s.ro("MATCH (f:Finding)-[:EVIDENCE_FOR]->(:Hypothesis {key:$k}) RETURN f.id",
                                      {"k": key})).result_set]
    for label, share in (("stances_without_links", 0.0), ("stances_with_links", 0.33)):
        rows = [{"finding_id": f, "stance": "supports", "weight": 0.5, "rationale": "r",
                 "same_outcome": i < len(fids) * share} for i, f in enumerate(fids)]
        out["writes"][label] = (await timed(lambda: s.write_stances(key, rows, []), 10))[0]
    out["writes"]["resolve_concepts"] = (await timed(lambda: s.resolve_concepts(
        [{"id": "new-x", "name": "outcome 5 alt"}, {"id": "new-y", "name": "other", "synonyms": ["outcome 9"]}]), 20))[0]
    backfill = ("MATCH (p:Paper)-[:DESCRIBES]->(:Study)-[:FOUND]->(f:Finding) WHERE f.paper_id IS NULL "
                "SET f.paper_id = p.id")
    await s.q("MATCH (f:Finding) REMOVE f.paper_id")
    out["writes"]["backfill_first"] = (await timed(lambda: s.q(backfill), 1))[0]
    out["writes"]["backfill_later"] = (await timed(lambda: s.q(backfill), 5))[0]

    await s.graph.delete()
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
