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
        "question": "Which outcomes does each funder type's money reach, and in which direction?",
        "hops": 3,
        "cypher": """MATCH (s:Substance {key:$k})-[:STUDIED_IN]->(p:Paper)-[:REPORTS]->(c:Claim {substance:$k})-[:ABOUT]->(o:Outcome)
OPTIONAL MATCH (p)-[:FUNDED_BY]->(f:Funder)
RETURN coalesce(f.type, 'undisclosed') AS funding, o.name AS outcome, c.direction AS direction, count(*) AS claims
ORDER BY claims DESC LIMIT 25""",
    },
    {
        "id": "contradiction-chains",
        "title": "Who contradicts whom",
        "question": "For every contradiction, which labs and funders sit on each side?",
        "hops": 6,
        "cypher": """MATCH (f1)<-[:FUNDED_BY|FROM_LAB]-(p1:Paper)-[:REPORTS]->(c1:Claim {substance:$k})-[r:CONTRADICTS]->(c2:Claim)<-[:REPORTS]-(p2:Paper)-[:FUNDED_BY|FROM_LAB]->(f2)
RETURN p1.label AS paper_a, f1.name AS backer_a, c1.text AS claim_a, r.reason AS reason, c2.text AS claim_b, p2.label AS paper_b, f2.name AS backer_b
LIMIT 25""",
    },
    {
        "id": "citation-reach",
        "title": "Citation reach",
        "question": "Which papers in this set build on each other, up to three citations deep?",
        "hops": "1–3",
        "cypher": """MATCH (s:Substance {key:$k})-[:STUDIED_IN]->(a:Paper)
MATCH path = (a)-[:CITES*1..3]->(b:Paper)
WHERE (s)-[:STUDIED_IN]->(b)
RETURN a.label AS citing, b.label AS cited, length(path) AS depth, b.credibility AS cited_credibility
ORDER BY depth, cited_credibility DESC LIMIT 25""",
    },
    {
        "id": "corroboration",
        "title": "Corroborated claims",
        "question": "Which claims are backed by a more credible paper, and how credible is that backing?",
        "hops": 4,
        "cypher": """MATCH (p1:Paper)-[:REPORTS]->(c1:Claim {substance:$k})-[:SUPPORTS]->(c2:Claim)<-[:REPORTS]-(p2:Paper)
MATCH (c1)-[:ABOUT]->(o:Outcome)
RETURN o.name AS outcome, c1.text AS claim, p1.label AS paper, p2.label AS backed_by, p2.credibility AS backer_credibility
ORDER BY backer_credibility DESC LIMIT 25""",
    },
    {
        "id": "shared-authors",
        "title": "Shared researchers",
        "question": "Which authors appear across this substance and others already in the graph?",
        "hops": 4,
        "cypher": """MATCH (s:Substance {key:$k})-[:STUDIED_IN]->(:Paper)-[:AUTHORED_BY]->(a:Author)<-[:AUTHORED_BY]-(:Paper)<-[:STUDIED_IN]-(t:Substance)
WHERE t.key <> $k
RETURN a.name AS author, collect(DISTINCT t.name) AS also_studied
LIMIT 25""",
    },
]


async def run_benchmarks(store: GraphStore, key: str, repeats: int = 7) -> list[dict]:
    out = []
    for q in QUERIES:
        timings, rows, header = [], [], []
        for _ in range(repeats):
            t0 = time.perf_counter()
            res = await store.ro(q["cypher"], {"k": key})
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
