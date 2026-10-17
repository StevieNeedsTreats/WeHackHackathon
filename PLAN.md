# TruthGraph: final redesign plan

This combines everything requested so far:
- every agent is LLM-powered, including the orchestrator;
- the LLM can be swapped behind one common client;
- the agents follow the Excalidraw flow;
- the FalkorDB data model is tuned per their docs;
- you can type any claim or question in plain language, in medicine or any other field.

## 1. What the product becomes

You type a claim or question in plain language. The agents turn it into one or more testable **hypotheses**, find real research that **supports or refutes** each one, score how credible each source is, group the findings, map contradictions, and give a graded verdict. It's tailored to medical papers, but the workflow is generic. A second, non-medical "domain pack" proves that.

```
"effects of minoxidyl on hairfall and also sideeffects of minoxidyl on pregrant women"
   │
   ▼  Intake agent
 H1  Minoxidil reduces hair loss                      (medical · adults with hair loss)
 H2  Minoxidil in pregnancy causes adverse outcomes   (medical · pregnant women)
   │
   ▼  Graph Manager (LLM) orchestrates, per hypothesis:
 Discovery ×N ─► Extractor ─► Credibility ─► Stance & Grouper ─► Contradiction Mapper ─► Verdict
   │
   ▼
 H1: Supported · grade A        H2: Insufficient evidence · grade D (case reports only) + gap flagged
```

## 2. Understanding the question: Intake agent (new)

This agent turns free text into a structured plan. It returns schema-validated output with these fields:
- **domain**: medical, economics, or general.
- **hypotheses[]**: a directional statement, so evidence can be marked as supporting or refuting it. Example: "Creatine improves cognitive performance."
  - **subject**: the substance, procedure, policy or intervention.
  - **outcome**.
  - **population** and **context**: optional.
  - **assumed defaults**: what the agent filled in, shown so the user can see it.
- **search hints**: synonyms, MeSH terms, spelling fixes ("minoxidyl" → minoxidil, "pregrant" → pregnant).
- **intent**: research, harm-seeking, self-harm, off-topic or injection. Fed to the guardrails.

How it handles the example prompts:

| Input | Result |
|---|---|
| "effects of minoxidyl on hairfall and also sideeffects … pregrant women" | 2 hypotheses (H1, H2 above) |
| "what happens if a pregrant girl takes minoxidyle" | **The same H2 key** as the row above. The existing graph is reused (cache hit), with no repeated research. |
| "effects of creatine on human intelligence vs creatine on muscle gain" | 2 hypotheses sharing the Creatine concept, shown **side by side**. Papers and findings already extracted are reused. |
| "Does raising the minimum wage reduce employment?" (other field) | economics domain, 1 hypothesis |

Concepts are resolved to stable IDs through a full-text index on `Concept.name`, plus MeSH or OpenAlex lookups. That gives each hypothesis a **deterministic key**: `hash(domain, subject, relation, outcome, population)`. Differently worded questions with the same meaning map to the same hypothesis.

The UI shows the interpretation as **editable chips** (Subject · Outcome · Population) before the run starts, so a misreading can be fixed in one click.

## 3. Agents (all LLM-powered)

Throughout, **LLMs make judgements and explain them; code does arithmetic and graph writes.**

| Agent | What the LLM does | Tools | Writes |
|---|---|---|---|
| **Intake** | Interprets the question, splits it into hypotheses, resolves concepts, classifies intent | `resolve_concept`, `find_existing_hypothesis` | `Question`, `Hypothesis`, `Concept` |
| **Graph Manager (orchestrator)** | Plans and runs the other agents, manages context, dedupes papers, re-searches when coverage is thin, enforces budgets | the other agents (see §4) | Redis run log |
| **Discovery** (×N in parallel per hypothesis: reviews, trials, safety, registries) | Writes source-specific queries and screens titles and abstracts for relevance | domain source tools (§6) | `Paper`, `CONSIDERED {relevance}` |
| **Extractor** (one per paper; doesn't depend on the hypothesis, so it's cached and reused) | Pulls out the **Studies** in each paper (n, design, population, methodology) with their **Findings** (outcome, direction, numeric effect, verbatim quote), plus Info (authors, funders, lab, region, conflicts of interest) | `get_abstract`, `get_fulltext` | `Study`, `Finding`, Info nodes |
| **Credibility** | Fills in the domain rubric's judgement items (blinding, randomisation, dropout, COI, identification strategy…). Code sums them to a 0–100 score with reasons. | `get_paper_metadata` | `Paper.credibility` |
| **Stance & Grouper** | Decides each finding's stance **relative to the hypothesis** (supports, refutes or mixed, with a rationale). Groups findings into clusters by context (population, dose, setting) using credibility, recency and population type. | `list_findings`, `get_credibility` | `EVIDENCE_FOR`, `Cluster` |
| **Contradiction Mapper** | Within clusters, decides whether conflicting findings really disagree or whether dose, population or duration explains the difference | `get_finding_context`, `compare_effects` (code) | `CONTRADICTS` |
| **Verdict / Insights** | Writes the verdict (Supported · Contested · Refuted · Insufficient evidence), insights, gaps and the narrative. It can run read-only graph queries for multi-hop questions. | `compute_consensus` (code: weighted shares, A–D grade), `graph_query_ro` | Hypothesis verdict; insights in Redis |

Two design points that fix weaknesses in today's code:
- **Stance lives on the edge, not the finding.** The same creatine finding can support "muscle gain" and be irrelevant to "intelligence". This also removes the current "positive on a safety outcome means no harm" workaround.
- **Extraction happens once per paper**, cached and shared across all questions. A new hypothesis only needs the cheap stance step on papers already read.

## 4. Graph Manager (LLM orchestrator)

- **Tools:**
  - `interpret_question`
  - `run_discovery(hypothesis, slices)`
  - `dedupe_papers`
  - `extract(paper_ids)`
  - `score(paper_ids)`
  - `map_stance(hypothesis)`
  - `map_contradictions(hypothesis)`
  - `write_verdict(hypothesis)`
  - `get_run_state`
  - `finish`
- **Parallelism stays.** One `extract([...])` call fans out per-paper agents behind a semaphore. Separate hypotheses run concurrently.
- **Context management:**
  - It never sees abstracts. `get_run_state` returns a compact digest built from the graph: hypotheses, papers with their status, counts and coverage gaps.
  - The full log is kept in a Redis Stream, so the digest can be rebuilt at any time.
- **Dedupe:**
  1. Exact matches through indexed DOI, PMID and normalised title.
  2. Full-text title candidates, then the LLM judges them (preprint vs published, conference vs journal), then a `SAME_AS` edge.
  3. Cross-question: hypothesis keys and cached extractions.
- **Safety rails:**
  - Budgets: at most 3 hypotheses per question, about 12 papers per hypothesis, a step limit, a token limit and a wall-clock limit.
  - If it stops early, the harness runs the mandatory stages anyway.
  - It has no write-Cypher tool, and sub-agent results reach it only as validated data, which limits prompt injection from abstracts.

## 5. Common LLM client (`backend/app/llm/`)

```python
class LLMClient(Protocol):
    async def structured(self, *, system, messages, schema, model=None) -> BaseModel
    async def stream_text(self, *, system, messages, model=None) -> AsyncIterator[str]
    async def chat(self, *, system, messages, tools, model=None) -> Turn   # one normalised tool-use step
```

- **Adapters:** `anthropic.py` and `openai_compat.py`. The second covers OpenAI, OpenRouter, Groq, Ollama and vLLM through `base_url`.
- **Config:**
  - `TG_LLM_PROVIDER`, `TG_LLM_MODEL` and `TG_LLM_BASE_URL` set the defaults.
  - Each agent can override its model, e.g. `TG_MODEL_ORCHESTRATOR=claude-sonnet-5-5` and `TG_MODEL_EXTRACTOR=claude-haiku-5-5`.
- **Built in:** retries, timeouts, a response cache in Redis, and token and cost accounting per agent, streamed to the UI.
- **`Agent` base class** (`agents/base.py`): system prompt, tools, output schema and step budget. It runs the tool loop and streams each tool call to the browser.

## 6. Domain packs: how it works for other fields

`backend/app/domains/` has one interface, and each pack provides:

| | **Medical** (tailored) | **Economics** (second example) |
|---|---|---|
| Sources | Europe PMC, ClinicalTrials.gov, OpenAlex citations | OpenAlex (all fields; abstracts rebuilt from its inverted index) |
| Study fields | design, n, population, dose, duration, blinding | identification strategy (RCT, natural experiment, DiD, IV, synthetic control, observational), sample, region, period |
| Credibility rubric | evidence hierarchy, sample, blinding, peer review, COI, recency | identification strength, sample, peer-reviewed vs working paper, replication, funder or think-tank ties |
| Concept kinds | intervention, outcome, population | policy, outcome, population |
| Disclaimer | not medical advice | not policy or financial advice |

The second example is "Does raising the minimum wage reduce employment?". Its research is genuinely contested (Card & Krueger vs Neumark & Wascher), so the contradiction map has real substance to show.

A **general** pack (OpenAlex only, with a generic rubric) handles anything else. The README and UI will say: *tailored to medicine; the same agentic workflow works for any claim*.

## 7. Data model (FalkorDB, tuned per their docs)

```
(:Question {id!, text, created})-[:ASKS]->(:Hypothesis {key!, statement, domain, verdict, grade,
                                                        share_support, share_refute, share_mixed, updated})
(:Hypothesis)-[:SUBJECT|OUTCOME|POPULATION]->(:Concept {id!, name~, kind, domain})
(:Hypothesis)-[:CONSIDERED {relevance}]->(:Paper {id!, doi*, pmid*, title_norm*, title~, year, design,
                                                  n, citations, peer_reviewed, retracted, credibility, cred_reasons, flags})
(:Paper)-[:DESCRIBES]->(:Study {id!, design, n, population, setting, exposure, duration})
(:Study)-[:FOUND]->(:Finding {id!, text, direction, effect_value, effect_unit, effect_text, quote, quote_verified})
(:Finding)-[:MEASURES]->(:Concept)                          outcome concept, reused across questions
(:Finding)-[:EVIDENCE_FOR {stance, weight, rationale}]->(:Hypothesis)
(:Finding)-[:IN_CLUSTER]->(:Cluster {id!, label, context})-[:OF]->(:Hypothesis)
(:Finding)-[:CONTRADICTS {reason, severity, explained_by}]->(:Finding)
(:Paper)-[:AUTHORED_BY {pos}]->(:Author {id!})   (:Paper)-[:AFFILIATED]->(:Lab {id!, country})
(:Paper)-[:FUNDED_BY]->(:Funder {id!, type})     (:Paper)-[:CITES|SAME_AS]->(:Paper)

!  range index + UNIQUE constraint    *  range index    ~  full-text index
```

**Efficiency rules, each from the FalkorDB docs:**

| Rule | Reason |
|---|---|
| **Writes are batched with `UNWIND`**, one query per stage or per paper | Today a run issues about 150–200 single-row write queries. This brings it down to a handful. |
| **Every query string is constant and parameterised** | The plan cache is keyed by query text. Also raise `CACHE_SIZE` (default 25) to 100 with `FALKORDB_ARGS` in `docker-compose.yml`. |
| **Unique constraints** on every `MERGE` key, each with its required exact-match index | The database enforces dedupe even with parallel agents writing. |
| **No indexes on low-cardinality fields** (stance, direction, severity) | The docs say they help little and still add write cost. |
| **`intern()`** on repeated strings: stance, direction, design, unit, kind, type, country, reason, severity | Saves RAM, since everything lives in memory. |
| **Large text and blobs go to Redis**, not the graph: `tg:abstract:{id}`, `tg:fulltext:{id}`, `tg:extract:{ver}:{paper}`, `tg:hyp:{key}:insights`, `tg:llm:{hash}`, and the run log stream `tg:run:{id}` (which replaces `Task` nodes) | Graph RAM should hold only what we traverse or filter on. |
| **Removed:** `SUPPORTS` edges, `Paper.funding` and `Paper.first_authors` copies, and blobs on Substance | Each relationship type is its own sparse matrix, and the copies duplicate existing edges. Agreement is now implied by stance plus cluster. |
| **Numeric `effect_value`** | Magnitude conflicts ("+10% vs +30%") become a Cypher comparison instead of regex. |
| **Stable external IDs** (DOI, PMID, OpenAlex) for papers, authors, labs and funders | Name-based merges confuse people and split spelling variants. |
| **Every hot query starts from an indexed lookup**, avoids `<>` anchors, and references relationship aliases when counting | These are known limitations in the docs. |

**Benchmark queries, rewritten to show off the model:**
- **Funding trail:** funder → paper → study → finding → hypothesis.
- **Who contradicts whom:** for each contradiction, the funders and labs on each side (8 hops).
- **Cross-hypothesis reuse:** findings that support one hypothesis but are irrelevant to or refute another with the same subject (the creatine example).
- **Citation reach:** the existing chains up to 3 deep.
- **Shared researchers:** authors who appear across hypotheses.

## 8. API and streaming

- `POST /api/interpret {text}` returns the interpretation (hypotheses, concepts, domain, guardrail result) for the editable chips.
- `GET /api/research/stream?question=…` streams SSE events.
  - New events: `interpretation`, `hypothesis`, `orchestrator` (decision + reason), `agent_step` (tool call), `finding`, `stance`, `cluster`, `verdict`, `usage` (tokens and cost).
  - Kept: `node`, `edge`, `flag`, `narrative` and `done`.
- `GET /api/question/{id}` and `GET /api/hypothesis/{key}` replace `/api/graph/{key}`. They return a snapshot in 3 indexed queries.

## 9. Frontend

- **Input:**
  - A free-text box with example prompts: the minoxidil two-parter, creatine intelligence vs muscle, and minimum wage.
  - The interpretation chips, editable before running.
- **Hypotheses:** shown as tabs, with a **compare** view for "X vs Y" questions. Each gets a verdict card with grade, support and refute shares, and gaps.
- **Graph:**
  - New node kinds: hypothesis, concept, study, finding and cluster.
  - Edges coloured by stance.
  - Contradiction edges keep their reason and severity.
- **Agent rail:** shows the orchestrator's decisions, each agent's tool calls, and tokens and cost per agent.
- **Domain:** a badge on each run and a domain-specific disclaimer.

## 10. Guardrails

- The Intake agent's intent classification sits on top of the existing regex checks, which stay as a hard floor.
- Pregnancy and minor-safety questions are **allowed**, because they are safety research, but they get a stronger disclaimer.
- Harm-seeking questions are still refused, and self-harm phrasing still points to crisis lines.
- Kept from today: allow-listed source hosts, verbatim-quote verification, the read-only Cypher console, rate limits and build caps.
- New: per-run LLM budgets.

## 11. Files

**New:**
- `backend/app/llm/*`
- `agents/base.py`, `agents/intake.py`, `agents/discovery.py`, `agents/stance.py`, `agents/tools.py`
- `domains/{base,medical,economics,general}.py`
- `fixtures/` (recorded demo runs)

**Rewritten:**
- `agents/orchestrator.py`, `extractor.py`, `credibility.py`, `contradictions.py`, `insights.py`, `metrics.py`
- `graph.py`: schema bootstrap with constraints, batched writes
- `sources.py`: adds OpenAlex search and ClinicalTrials.gov
- `guardrails.py`, `main.py`, `config.py`, `demo.py` (now a record-and-replay tool)

**Frontend:**
- `lib/types.ts`, `store.ts`, `api.ts`
- New `QueryInput` / `Interpretation` and `HypothesisTabs` components
- `graph/nodes.tsx`, `edges.tsx` and the panels

**Other:** `docker-compose.yml` (`FALKORDB_ARGS`) and `README.md`.

**Removed:** the regex rule extractor.

## 12. Phases, each ending in a working state

1. **Foundations:** LLM client and adapters, the `Agent` base, the new graph schema and batched store, and the domain-pack interface. Tests use mocked providers and `GRAPH.EXPLAIN`, asserting `Index Scan`.
2. **Intake → Discovery → Extractor → Credibility** for the medical pack, run in a fixed order so the end-to-end path works before the orchestrator exists.
3. **Stance & Grouper → Contradictions → Verdict.**
4. **LLM Graph Manager** replaces the fixed order, adding dedupe, budgets and the context digest.
5. **Frontend:** free-text input, chips, hypothesis tabs and compare view, the new nodes, and the agent-step rail.
6. **Economics pack** and recorded demo fixtures for 3 showcase prompts, plus the README.

## 13. Verification

- **Golden tests for Intake** using the example prompts, typos included, and asserting that the two pregnancy phrasings produce the same hypothesis key.
- **Adapter tests** against both providers.
- **Index-plan and constraint tests.**
- **Live end-to-end runs** of all 3 showcase prompts, comparing write-query count, snapshot latency and Redis memory before and after.
- **Offline demo replay**, plus a frontend build and lint, then running the app and taking screenshots.

## 14. Risks

- **Cost and latency** go up. Budgets, cheap worker models and caching keep them bounded.
- **Sparse evidence**, such as minoxidil in pregnancy, has to come back as an honest "Insufficient evidence" verdict, never a forced one.
- **LLM nondeterminism** is reduced by caching structured outputs.
- **External API rate limits.** OpenAlex wants a contact email in requests, so add a `TG_CONTACT_EMAIL` setting rather than hardcoding one.

## 15. Defaults (to confirm)

1. **Providers:** Anthropic + OpenAI-compatible. No native Gemini adapter.
2. **No API key:** the rule engine is dropped. **Load demo** replays recorded LLM runs, so it still works offline.
3. **Text:** abstracts by default. Open-access full text is behind `TG_FULLTEXT=1`.
4. **Second domain:** economics, using minimum wage → employment. A more relatable alternative is "screen time and teen mental health" (psychology).
5. **Embeddings / vector index:** not for now.
6. **Execution:** all 6 phases, pausing for review after phase 3.

## 16. How each hypothesis is shown

1. **Interpretation card** (before the run): one row per hypothesis with editable Subject / Outcome / Population chips, an on/off checkbox, a "researched before" marker, and the spelling fixes the Intake agent made. Nothing runs until the user confirms.
2. **Hypothesis bar** (replaces the stat strip): one card per hypothesis with live status, verdict, grade and a credibility-weighted support / refute / mixed bar. Clicking a card focuses that hypothesis; a Compare card appears when there are two or more.
3. **Graph, tug-of-war layout**: the focused hypothesis sits in the middle, supporting papers on the left, refuting papers on the right, mixed at the bottom, each column sorted by credibility. Contradiction edges cross the middle. Other hypotheses collapse to one dimmed node; shared papers get an "also in H2" ring. An "All" mode shows the free-form graph.
4. **Right panel, scoped to the focused hypothesis**: Verdict (replaces Insights: verdict, grade reasons, balance bar, clusters, contradictions, gaps, narrative) and Evidence (findings grouped by stance with quote, paper, credibility and the stance rationale). Queries and Details are unchanged.
5. **Compare view**: opens by default for "X vs Y" prompts; hypotheses side by side with verdict, balance, best evidence, paper count, key contradiction and shared papers.
6. **Elsewhere**: agent rail steps carry the hypothesis chip; the sidebar nests hypotheses under past questions; `/?q=<question>&h=<hypothesis>` deep-links; sparse evidence says plainly what was and wasn't found.

## 17. Decisions taken for implementation

All §15 defaults are adopted, plus the tug-of-war layout and Compare-by-default for "vs" prompts. Demo mode replays recorded or scripted LLM output through the same agents, so it runs without an API key.
