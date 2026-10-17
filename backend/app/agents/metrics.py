"""Multi-hop query benchmarks.

These are the questions the graph model exists to answer. Each one crosses several
relationship types; in a relational store they would be 3–6 joins. We run each a few
times on FalkorDB and report rows, hop count and median / p95 latency.
"""

from __future__ import annotations

import statistics
import time

from ..graph import GraphStore, to_jsonable

QUERIES = [
    {
        "id": "funding-trail",
        "title": "Funding trail",
        "question": "For each hypothesis, which kinds of funder paid for the supporting vs refuting evidence?",
        "hops": 3,
        "cypher": """MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)<-[e:EVIDENCE_FOR]-(x:Finding)
MATCH (p:Paper {id:x.paper_id})
OPTIONAL MATCH (p)-[:FUNDED_BY]->(f:Funder)
RETURN h.statement AS hypothesis, coalesce(f.type, 'undisclosed') AS funder_type, e.stance AS stance,
       count(DISTINCT p) AS papers
ORDER BY hypothesis, papers DESC""",
    },
    {
        "id": "who-contradicts-whom",
        "title": "Who contradicts whom",
        "question": "Which labs' findings contradict which other labs' findings, and why?",
        "hops": 4,
        "cypher": """MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)
MATCH (a:Finding)-[c:CONTRADICTS]->(b:Finding) WHERE c.hypothesis = h.key
MATCH (pa:Paper {id:a.paper_id}), (pb:Paper {id:b.paper_id})
OPTIONAL MATCH (pa)-[:AFFILIATED]->(la:Lab)
OPTIONAL MATCH (pb)-[:AFFILIATED]->(lb:Lab)
RETURN pa.label AS paper_a, la.name AS lab_a, pb.label AS paper_b, lb.name AS lab_b, c.reason AS reason,
       c.explained_by AS explained_by
LIMIT 25""",
    },
    {
        "id": "cross-hypothesis",
        "title": "Evidence reused across hypotheses",
        "question": "Which papers inform more than one hypothesis anywhere in the graph?",
        "hops": 3,
        "cypher": """MATCH (:Question {id:$q})-[:ASKS]->(:Hypothesis)-[:CONSIDERED]->(p:Paper)
MATCH (p)<-[:CONSIDERED]-(h:Hypothesis)
WITH p, collect(DISTINCT h.statement) AS hypotheses
WHERE size(hypotheses) > 1
RETURN p.label AS paper, p.title AS title, hypotheses
LIMIT 25""",
    },
    {
        "id": "citation-reach",
        "title": "Citation reach",
        "question": "Which considered papers are reached through chains of up to 3 citations?",
        "hops": 4,
        "cypher": """MATCH (:Question {id:$q})-[:ASKS]->(:Hypothesis)-[:CONSIDERED]->(a:Paper)
MATCH (a)-[:CITES*1..3]->(b:Paper)
RETURN b.label AS paper, count(DISTINCT a) AS reached_from, max(b.credibility) AS credibility
ORDER BY reached_from DESC
LIMIT 15""",
    },
    {
        "id": "shared-researchers",
        "title": "Shared researchers",
        "question": "Which authors also published on other hypotheses in the graph?",
        "hops": 5,
        "cypher": """MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)-[:CONSIDERED]->(:Paper)-[:AUTHORED_BY]->(a:Author)
MATCH (a)<-[:AUTHORED_BY]-(:Paper)<-[:CONSIDERED]-(o:Hypothesis)
WHERE o.key <> h.key
RETURN a.name AS author, collect(DISTINCT o.statement)[..3] AS other_hypotheses
LIMIT 15""",
    },
]


async def run_benchmarks(store: GraphStore, qid: str, repeats: int = 7) -> list[dict]:
    out = []
    for q in QUERIES:
        timings, rows, header = [], [], []
        for _ in range(repeats):
            t0 = time.perf_counter()
            res = await store.ro(q["cypher"], {"q": qid})
            timings.append((time.perf_counter() - t0) * 1000)
            rows, header = res.result_set, res.header
        timings.sort()
        out.append({
            **q,
            "rows": len(rows),
            "columns": [h[1] if isinstance(h, (list, tuple)) else str(h) for h in header],
            "sample": to_jsonable(rows[:8]),
            "median_ms": round(statistics.median(timings), 2),
            "p95_ms": round(timings[min(len(timings) - 1, int(len(timings) * 0.95))], 2),
        })
    return out
