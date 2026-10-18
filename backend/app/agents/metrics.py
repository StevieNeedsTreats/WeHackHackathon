"""Multi-hop query benchmarks.

These are the questions the graph model exists to answer. Each one crosses several
relationship types; in a relational store they would be 3–6 joins. The last two run
FalkorDB's built-in graph algorithms (algo.*) inside the query. We run each a few times
on FalkorDB and report rows, hop count, median / p95 latency and the execution plan.
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
WITH a, b, c
MATCH (pa:Paper) WHERE pa.id = a.paper_id
MATCH (pb:Paper) WHERE pb.id = b.paper_id
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
    {
        "id": "influential-papers",
        "title": "Most influential papers",
        "question": "Which of this question's papers does the literature lean on most, by PageRank over every citation in the graph?",
        "hops": "algo.pageRank",
        "cypher": """CALL algo.pageRank('Paper', 'CITES') YIELD node, score
MATCH (:Question {id:$q})-[:ASKS]->(:Hypothesis)-[:CONSIDERED]->(node)
WITH DISTINCT node, score
RETURN node.label AS paper, round(score * 1000000) / 1000000.0 AS pagerank, node.credibility AS credibility,
       size([(node)<-[:CITES]-(:Paper) | 1]) AS cited_by
ORDER BY pagerank DESC
LIMIT 15""",
    },
    {
        "id": "contradiction-camps",
        "title": "Contradiction camps",
        "question": "Where does the evidence split into groups of findings joined by contradictions (connected components)?",
        "hops": "algo.WCC",
        "cypher": """CALL algo.WCC({nodeLabels: ['Finding'], relationshipTypes: ['CONTRADICTS']}) YIELD node, componentId
MATCH (node)-[e:EVIDENCE_FOR]->(h:Hypothesis)<-[:ASKS]-(:Question {id:$q})
WITH h, componentId, count(DISTINCT node) AS findings, collect(DISTINCT e.stance) AS stances
WHERE findings > 1
RETURN h.statement AS hypothesis, componentId AS camp, findings, stances
ORDER BY findings DESC
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
        plan = await store.explain(q["cypher"], {"q": qid})
        out.append({
            **q,
            "rows": len(rows),
            "columns": [h[1] if isinstance(h, (list, tuple)) else str(h) for h in header],
            "sample": to_jsonable(rows[:8]),
            "median_ms": round(statistics.median(timings), 2),
            "p95_ms": round(timings[min(len(timings) - 1, int(len(timings) * 0.95))], 2),
            "plan": plan,
        })
    return out
