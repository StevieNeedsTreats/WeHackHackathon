# TruthGraph

Type a substance or intervention (creatine, vitamin D, minoxidil). A team of agents reads the literature, pulls out every claim, scores how credible each source is, and maps where the evidence agrees and where it contradicts itself. Results stream live into a FalkorDB graph.

- **Frontend:** Next.js 15, React Flow
- **Backend:** FastAPI (Python 3.13), server-sent events
- **Graph store:** FalkorDB

## Run it

```bash
docker compose up -d                      # FalkorDB on :6380
cd backend && ./run.sh                    # API on :8100
cd frontend && npm install && npm run dev -- -p 3100
```

Open http://localhost:3100. **Load demo** replays the creatine example from the design board offline. Any other search runs live against Europe PMC and OpenAlex.

To use Claude for extraction instead of the built-in rule extractor, set `ANTHROPIC_API_KEY` before starting the API. It uses `claude-haiku-5-5`, the cheapest model, as the board specifies for extraction and summaries. All backend settings use the `TG_` prefix; see `backend/app/config.py`.

## Agents

| Agent | Does | Writes |
|---|---|---|
| Search / Discovery | Queries Europe PMC for meta-analyses, RCTs and safety studies; links citations through OpenAlex | `Paper`, `Author`, `Lab`, `Funder`, `CITES` |
| Structured Extractor | Pulls each claim's outcome, effect size and supporting quote from the abstract and labels it positive, mixed or negative | `Claim`, `Outcome` |
| Credibility Enricher | Scores 0–100 from metadata only (design, sample, citations, peer review, funding, recency), with itemised reasons | `Paper.credibility`, flags |
| Claim Grouper | Groups claims by outcome across papers | outcome counts |
| Contradiction Mapper | Adds a `CONTRADICTS` edge when two papers disagree in direction or magnitude; adds `SUPPORTS` toward the strongest agreeing claim | edges with reason and severity |
| Insights | Credibility-weighted consensus and an A–D evidence grade per outcome, plus funding skew, safety signals and evidence gaps | streamed to the UI and stored on `Substance` |
| Graph Manager | Runs the agents in parallel, dedupes fetches and extractions, records progress as `Task` nodes, benchmarks queries | `Task` |

Every step streams to the browser as it happens. Nodes slide into place as papers re-sort by credibility.

## Data model

```
(:Substance)-[:STUDIED_IN]->(:Paper)-[:REPORTS]->(:Claim)-[:ABOUT]->(:Outcome)
(:Paper)-[:AUTHORED_BY]->(:Author)    (:Paper)-[:FROM_LAB]->(:Lab {region})
(:Paper)-[:FUNDED_BY]->(:Funder {type})    (:Paper)-[:CITES]->(:Paper)
(:Claim)-[:CONTRADICTS {reason, severity}]->(:Claim)    (:Claim)-[:SUPPORTS]->(:Claim)
(:Task)-[:FOR]->(:Substance)
```

All substances share one graph:

- **Shared entities:** papers, authors, labs and funders are merged across substances, so later runs reuse what earlier runs found.
- **Agent memory:** fetched pages and extractions are cached in Redis inside the same FalkorDB instance.
- **Disagreement:** stored as a first-class edge, so "who contradicts whom, and who funded each side" is a single traversal.

The **Queries** tab benchmarks five multi-hop questions on every build and shows the median and p95 latency for each, with hop counts from 3 to 6. Examples:

- funder → paper → claim → outcome
- lab or funder on each side of a contradiction
- variable-length citation chains

## Guardrails

- **Input:** length and character checks; rejects harm-seeking phrasing (lethal dose, synthesis) and points self-harm phrasing to crisis lines; blocks prompt and Cypher injection. Checked live while typing and again on the server.
- **Sources:** only allow-listed hosts; timeouts, retries and a response-size cap.
- **Model output:** schema-constrained. Abstracts are treated as untrusted data. Every quote must appear verbatim in the abstract; claims that fail count at half weight and are flagged.
- **Graph:** all writes are parameterised. The Cypher console uses `GRAPH.RO_QUERY` with a write-keyword denylist, a 3-second timeout and a 500-row cap.
- **API:** per-client rate limits, a cap on concurrent builds, and one build per substance at a time.
- **Output:** every outcome carries an evidence grade, and the app shows a not-medical-advice notice.
