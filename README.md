# TruthGraph

Ask about any claim in plain language, for example "effects of minoxidil on hair loss and side effects in pregnant women" or "creatine on intelligence vs muscle gain". LLM agents:

- split the question into testable hypotheses;
- search the literature for evidence that supports or refutes each one;
- pull out every study and finding, and score how credible each source is;
- map where the evidence agrees and where it contradicts itself.

Everything streams live into a FalkorDB graph.

It is tuned for medicine (Europe PMC, ClinicalTrials.gov), but the agents are domain-agnostic. The same workflow handles economics ("Does raising the minimum wage reduce employment?") and general claims through OpenAlex.

- **Frontend:** Next.js 15, React Flow
- **Backend:** FastAPI (Python 3.13), server-sent events
- **Graph store:** FalkorDB
- **LLMs:** Claude by default, or any OpenAI-compatible endpoint

## Run it

```bash
docker compose up -d                      # FalkorDB on :6380, Redis cache on :6381
export ANTHROPIC_API_KEY=...              # or see "Swapping the LLM"
cd backend && ./run.sh                    # API on :8100
cd frontend && npm install && npm run dev -- -p 3100
```

Open http://localhost:3100.

To use hosted services instead of the local containers, set these in `backend/.env` and skip `docker compose`:

```bash
TG_DB_INSTANCE=<public host>:<port>       # from the instance's connection details
TG_DB_USER=...
TG_DB_PASS=...
TG_REDIS_URL=rediss://<user>:<pass>@<host>:<port>   # any Redis, for the side storage
```

FalkorDB holds only the evidence graph. The side storage (abstracts, verdicts, run logs, LLM and HTTP caches) lives in a separate Redis.

- **Asking a question:** the question is interpreted first. You can drop a hypothesis or change its population before the research starts.
- **Demo:** "Watch demo" replays a recorded run through the real agents, so it works without an API key.

All backend settings use the `TG_` prefix; see `backend/app/config.py`.

### Access password

Set `TG_APP_PASSWORD` in `backend/.env` to require a password. The frontend shows a sign-in screen, and every API route except sign-in needs a token.

| Setting | Effect |
|---|---|
| `TG_APP_PASSWORD` | The shared password. Leave it empty only for local development: the API is then open to anyone who can reach it. |
| `TG_AUTH_ACCESS_MINUTES` | Lifetime of the access token sent with each request (default 30). |
| `TG_AUTH_REFRESH_DAYS` | Lifetime of the refresh token (default 30). Each refresh issues a new one, so you stay signed in while you keep using it. |
| `TG_AUTH_SECRET` | Optional signing key for tokens. By default it is derived from the password, so changing the password signs everyone out. |

### Swapping the LLM

Every agent talks to one `LLMClient` interface (`backend/app/llm/`).

| Setting | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Claude. Workers use `claude-haiku-5-5`; the orchestrator uses `claude-sonnet-5-5`. |
| `TG_LLM_PROVIDER=openai` with `TG_LLM_BASE_URL`, `TG_LLM_API_KEY` and `TG_LLM_MODEL` | OpenAI, OpenRouter, Groq, vLLM or Ollama. |
| `TG_MODEL_<AGENT>` | Overrides the model for one agent, e.g. `TG_MODEL_EXTRACTOR`. |
| `TG_LLM_CONCURRENCY` | Caps requests in flight. Use 1 for a local server. |

### Recording a demo

```bash
cd backend && uv run python -m app.demo record "creatine on intelligence vs muscle gain"
```

This runs the live pipeline once and saves every LLM answer, search result and citation link to `backend/app/demo_bundles/`. Replaying the bundle runs the same agents and orchestrator offline.

## Agents

Every agent is LLM-powered and returns schema-validated output. Code does the arithmetic (scores, weights, grades), so the numbers are reproducible and the LLM only judges what code can't.

| Agent | Does | Writes |
|---|---|---|
| **Graph Manager** (orchestrator) | Plans the run from a compact digest, calls the other agents as tools, runs independent work in parallel, judges near-duplicate papers. Budgets cap its steps, tokens and time; the harness finishes any stage it skips. | run log in a Redis stream |
| Intake | Turns free text into up to 3 directional hypotheses with subject / outcome / population concepts, fixes spelling, picks the domain, classifies intent | `Question`, `Hypothesis`, `Concept` |
| Search / Discovery | One agent per hypothesis × source slice (reviews, trials, safety, registry…); writes source-specific queries with a search tool and keeps only papers that address the hypothesis | `Paper`, `Author`, `Lab`, `Funder`, `CONSIDERED`, `CITES` |
| Structured Extractor | Per paper: its studies (design, participants, population, dose, duration) and findings (outcome, direction, effect size, verbatim quote). Cached per paper and reused across questions. | `Study`, `Finding` |
| Credibility Enricher | Code scores the metadata (design, sample, citations, peer review, recency); the LLM judges the domain rubric (blinding, attrition, identification, conflicts) within fixed bounds. 0–100 with itemised reasons. | `Paper.credibility`, flags |
| Stance & Grouper | Per hypothesis: whether each finding supports, refutes or is mixed, how well its population matches, and clusters of findings sharing a context | `EVIDENCE_FOR {stance, weight}`, `Cluster` |
| Contradiction Mapper | Judges code-proposed conflicting pairs: is it a real disagreement, or explained by population, dose or measure? | `CONTRADICTS {hypothesis, reason}` |
| Verdict | Code computes the credibility-weighted balance and an A–D grade; the LLM writes the summary, insights and gaps and may run read-only graph queries | `Hypothesis.verdict` |

### Domain packs

`backend/app/domains/` holds one pack per field: medical, economics and general. Each pack sets:

- the search slices and sources;
- the study designs and their weights;
- the credibility rubric;
- domain notes for the extractor, stance and verdict prompts.

Adding a field means adding a pack, not changing the agents.

## Data model

To explore the schema interactively, open [`docs/data-model.html`](docs/data-model.html) in a browser. Pick one of the app's queries and its path lights up across the graph.

```
(:Question)-[:ASKS]->(:Hypothesis)-[:SUBJECT|OUTCOME|POPULATION]->(:Concept)
(:Hypothesis)-[:CONSIDERED {relevance, slice}]->(:Paper)
(:Paper)-[:DESCRIBES]->(:Study)-[:FOUND]->(:Finding {paper_id})-[:MEASURES]->(:Concept {synonyms})
(:Finding)-[:MEASURES {hypothesis}]->(:Concept)   the hypothesis's outcome, under another name
(:Finding)-[:EVIDENCE_FOR {stance, weight, rationale, same_outcome}]->(:Hypothesis)
(:Finding)-[:IN_CLUSTER]->(:Cluster)-[:OF]->(:Hypothesis)
(:Finding)-[:CONTRADICTS {hypothesis, reason, severity, explained_by}]->(:Finding)
(:Paper)-[:AUTHORED_BY]->(:Author)  (:Paper)-[:AFFILIATED]->(:Lab)  (:Paper)-[:FUNDED_BY]->(:Funder)
(:Paper)-[:CITES]->(:Paper)  (:Paper)-[:SAME_AS]->(:Paper)
```

- **Stance on the edge:** stance lives on `EVIDENCE_FOR`, not on the finding. One finding can support one hypothesis and be irrelevant to another, and papers, studies and findings are shared across every question.
- **Deterministic keys:** a hypothesis's key comes from its domain, subject, outcome and population. Differently worded questions with the same meaning reuse earlier research, and a concept named by one of an existing concept's synonyms resolves to that concept first.
- **FalkorDB specifics:**
  - unique constraints on ids, plus range indexes on DOI, PMID and normalised title for dedupe;
  - full-text indexes on concept names and paper titles;
  - relationship indexes on `CONTRADICTS.hypothesis` and `MEASURES.hypothesis`;
  - batched `UNWIND` writes with constant parameterised queries, so the plan cache hits;
  - `intern()` for repeated strings.
- **Redis beside the graph:** abstracts and agent caches (HTTP responses, LLM answers, extractions) live outside the graph.

The **Queries** tab benchmarks five multi-hop questions on every run (funding trail, who contradicts whom, evidence reused across hypotheses, citation reach, shared researchers) and includes a read-only Cypher console.

### Optimizations

Three changes to the model and its queries. [`docs/optimizations.html`](docs/optimizations.html) shows each one as a before-and-after diagram.

| Change | Before | After |
|---|---|---|
| **Findings link to the hypothesis outcome** | The Intake agent named the outcome "muscle mass" and the Extractor named each paper's outcome in the paper's own words ("lean body mass"). Each name became its own `Concept`, so most findings never reached the hypothesis's concept. | The Stance agent also judges `same_outcome`. Matching findings get `MEASURES {hypothesis}` to the hypothesis's concept, and their wording is added to its `synonyms`. A later question using a synonym resolves to the same concept and key, so it reuses the research. |
| **One row per paper in the snapshot** | Three `OPTIONAL MATCH`es for authors, funders and labs multiplied each paper into up to 3 × 3 × 2 = 18 rows, and `collect(DISTINCT …)` then dropped the duplicates. | Pattern comprehensions return each paper once, with its three lists. |
| **Finding → Paper without the Study hop** | Queries walked `(:Finding)<-[:FOUND]-(:Study)<-[:DESCRIBES]-(:Paper)` just to reach the paper. | Findings store `paper_id`, and older findings are backfilled at startup. The funding trail drops from 5 hops to 3 and "who contradicts whom" from 7 to 4. |

#### Benchmark

Each changed query was timed in its old and new form on a synthetic graph shaped like the real one: 15,795 nodes and 50,002 edges, from 20 questions × 3 hypotheses × 40 papers. Times are the median of 40 runs on a local FalkorDB, measured on 17 Oct 2026. Charts are in [`docs/optimizations.html`](docs/optimizations.html#benchmark).

| Query | Before | After | Change |
|---|---:|---:|---|
| Funding trail | 4.33 ms | 2.93 ms | 32% faster, same 18 rows |
| Who contradicts whom | 8.10 ms | 5.64 ms | 30% faster, same 25 rows |
| Canvas papers with authors, funders, labs | 40.47 ms | 42.77 ms | about the same; 2,154 raw rows → 120 |
| Save stances for one hypothesis (120 findings) | 2.7 ms | 6.8 ms | +4 ms for the outcome links |
| Match concepts through synonyms | – | 0.9 ms | once per question |
| Fill in `paper_id` on old findings | – | 50 ms, then 1 ms | at startup |

Network time to FalkorDB Cloud is larger than any of these differences. To reproduce, run `cd backend && uv run python -m app.bench`. It builds a scratch graph (`truthgraph_bench`), checks that old and new queries return the same rows, and deletes the graph afterwards.

## The UI

- **Hypothesis bar:** each hypothesis gets a card with live status, verdict, grade and a support / refute balance.
- **Graph:** focusing a hypothesis lays it out as a tug of war:
  - supporting findings and their papers pull from the left;
  - refuting ones pull from the right;
  - mixed findings hang below.

  Contradiction edges cross the middle. **All** shows the whole question, and **Compare** puts hypotheses side by side.
- **Right panel:** scoped to the focused hypothesis. It shows the verdict and why, clusters, contradictions, who funded each side, gaps, and every finding with its quote and rationale.

## Guardrails

- **Input:**
  - free text up to 400 characters;
  - obvious harm-seeking and injection phrasing is rejected before any LLM call, and self-harm phrasing points to crisis lines;
  - the Intake agent classifies the rest;
  - questions about pregnancy, children and other vulnerable groups are allowed and get an extra notice.
- **Sources:** only allow-listed hosts, with timeouts, retries and a response-size cap.
- **Model output:**
  - schema-validated, with bounded rubric points;
  - paper text is treated as untrusted data;
  - every quote is checked verbatim against the source, and findings whose quote fails count at half weight and are flagged.
- **Budgets:** caps on orchestrator steps, tokens per run, run time and LLM concurrency.
- **Graph:**
  - all writes are parameterised;
  - the Cypher console and the Verdict agent's query tool use `GRAPH.RO_QUERY` with a write-keyword denylist, a 3-second timeout and a row cap.
- **API:** per-client rate limits, a cap on concurrent runs, and one run per question at a time.
- **Output:** every hypothesis carries an evidence grade, and the app shows a not-medical-advice notice.
