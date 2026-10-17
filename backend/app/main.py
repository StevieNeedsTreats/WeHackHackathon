from __future__ import annotations

import asyncio
import hashlib
import json
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .agents.base import AgentContext
from .agents.intake import IntakeAgent, IntakeOut, hypothesis_key
from .agents.metrics import QUERIES, run_benchmarks
from .agents.orchestrator import Run
from .config import get_settings
from .demo import DemoBundle, build_question, bundles
from .domains import DOMAINS, get_domain
from .graph import GraphStore, slug, to_jsonable
from .guardrails import (DISCLAIMER, INTENT_MESSAGES, VULNERABLE_NOTE, RateLimiter, mentions_vulnerable,
                         screen_cypher, screen_question)
from .llm import LLMError, LLMRouter, LLMUnavailable, UsageMeter, llm_status
from .sources import Sources

settings = get_settings()
state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = GraphStore()
    await store.init()
    state["store"] = store
    state["sources"] = Sources()
    state["limiter"] = RateLimiter(settings.rate_limit_per_min)
    state["runs"] = asyncio.Semaphore(settings.max_concurrent_runs)
    state["active"] = set()
    yield
    await state["sources"].close()


app = FastAPI(title="TruthGraph API", version="2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _client(request: Request) -> str:
    return request.client.host if request.client else "anon"


def _limit(request: Request, suffix: str = "") -> None:
    allowed, retry = state["limiter"].allow(_client(request) + suffix)
    if not allowed:
        raise HTTPException(429, f"Rate limit reached. Try again in {int(retry) + 1}s.")


@app.get("/api/health")
async def health():
    store: GraphStore = state["store"]
    ok = await store.ping()
    counts = await store.counts() if ok else {"nodes": 0, "edges": 0}
    return {
        "falkordb": ok, "graph": settings.graph_name, **counts, "llm": llm_status(), "disclaimer": DISCLAIMER,
        "domains": [{"id": d.id, "name": d.name, "examples": d.examples} for d in DOMAINS.values()],
        "demos": bundles(),
    }


# ====================================================================== interpretation


class InterpretIn(BaseModel):
    text: str = Field(max_length=400)
    mode: str = Field(default="live", pattern="^(live|demo)$")


async def interpret(text: str, mode: str, redis) -> tuple[dict, LLMRouter, DemoBundle | None]:
    """Guardrails, then the Intake agent. Returns the interpretation the user can edit."""
    guard = screen_question(text)
    if not guard.ok:
        return {"ok": False, "code": guard.code, "message": guard.message, "checks": guard.checks}, None, None
    bundle = DemoBundle.match(guard.value) if mode == "demo" else None
    if mode == "demo" and bundle is None:
        return {"ok": False, "code": "no-demo", "message": "No recorded demo for that question. Pick one of the examples.",
                "checks": guard.checks}, None, None
    router = bundle.router() if bundle else LLMRouter.live(redis)

    async def ignore(*_):
        return None

    out: IntakeOut = await IntakeAgent().run(AgentContext(router, UsageMeter(50_000), ignore), guard.value)
    if out.intent != "research" or not out.hypotheses:
        return {"ok": False, "code": out.intent, "message": out.message or INTENT_MESSAGES.get(out.intent, ""),
                "checks": guard.checks}, None, None
    q = build_question(guard.value, out, demo=bundle is not None)
    domain = get_domain(q["domain"])
    notice = VULNERABLE_NOTE if mentions_vulnerable(guard.value, *[
        (h["population"] or {}).get("name") for h in q["hypotheses"]]) else None
    return {"ok": True, "checks": guard.checks, "question": q, "notice": notice, "disclaimer": domain.disclaimer,
            "domain": {"id": domain.id, "name": domain.name, "subject": domain.subject_label,
                       "outcome": domain.outcome_label, "population": domain.population_label}}, router, bundle


@app.post("/api/interpret")
async def interpret_endpoint(body: InterpretIn, request: Request):
    _limit(request, ":i")
    try:
        res, _, _ = await interpret(body.text, body.mode, state["sources"].redis)
    except LLMUnavailable as e:
        raise HTTPException(503, str(e))
    except LLMError as e:
        raise HTTPException(502, f"The intake agent failed: {e}"[:300])
    return res


# ====================================================================== research stream


def _merge_edits(q: dict, edits: str | None) -> dict:
    """Apply the user's edits to the interpretation: drop hypotheses, or set a population."""
    if not edits:
        return q
    try:
        e = json.loads(edits)
    except ValueError:
        raise HTTPException(400, "Bad interpretation edits")
    keep = set(e.get("keep") or [h["key"] for h in q["hypotheses"]])
    q["hypotheses"] = [h for h in q["hypotheses"] if h["key"] in keep] or q["hypotheses"][:1]
    # A changed population is a different hypothesis, so it gets a new key.
    for h in q["hypotheses"]:
        if h["key"] in (e.get("population") or {}):
            name = (e["population"][h["key"]] or "").strip()[:80]
            h["population"] = {"id": slug(name), "name": name, "synonyms": []} if slug(name) else None
            h["key"] = hypothesis_key(q["domain"], h["subject"], h["outcome"], h["population"])
    q["id"] = hashlib.sha1((q["domain"] + "|" + "|".join(sorted(h["key"] for h in q["hypotheses"]))).encode()).hexdigest()[:10]
    if e.get("fresh"):
        q["fresh"] = True
    return q


@app.get("/api/research/stream")
async def research(request: Request, q: str = Query(..., max_length=400),
                   mode: str = Query("live", pattern="^(live|demo)$"), edits: str | None = Query(None, max_length=2000)):
    _limit(request)

    async def refused(payload: dict):
        yield {"event": "guardrail", "data": json.dumps(payload)}
        yield {"event": "end", "data": "{}"}

    try:
        interp, router, bundle = await interpret(q, mode, state["sources"].redis)
    except LLMUnavailable as e:
        return EventSourceResponse(refused({"ok": False, "code": "no-llm", "message": str(e)}))
    except LLMError as e:
        return EventSourceResponse(refused({"ok": False, "code": "intake-error", "message": str(e)[:300]}))
    if not interp["ok"]:
        return EventSourceResponse(refused(interp))

    question = interp["question"] if bundle else _merge_edits(interp["question"], edits)
    if bundle:
        question["fresh"] = True
    qid = question["id"]
    if qid in state["active"]:
        raise HTTPException(409, "That question is already being researched. Open it from the sidebar when it finishes.")

    run = Run(state["store"], state["sources"], router, question, mode,
              search=bundle.search if bundle else None, fulltext=bundle.fulltext if bundle else None,
              cites=bundle.cites if bundle else None, pace=1.0 if bundle else 0.0)

    async def stream():
        yield {"event": "guardrail", "data": json.dumps({"ok": True, "checks": interp["checks"]})}
        yield {"event": "interpretation", "data": json.dumps({k: interp[k] for k in ("question", "notice", "disclaimer",
                                                                                       "domain")}, default=str)}
        async with state["runs"]:
            state["active"].add(qid)
            task = asyncio.create_task(run.execute())
            try:
                while True:
                    msg = await run.queue.get()
                    if msg is None:
                        break
                    if await request.is_disconnected():
                        task.cancel()
                        break
                    data = msg["data"] if isinstance(msg["data"], dict) else {"items": msg["data"]}
                    yield {"event": msg["event"], "data": json.dumps({"_t": msg["t"], **data}, default=str)}
            finally:
                state["active"].discard(qid)
                if not task.done():
                    task.cancel()
        yield {"event": "end", "data": "{}"}

    return EventSourceResponse(stream(), ping=10)


# ====================================================================== reads


def _check_id(v: str) -> str:
    if not v.replace("-", "").isalnum() or len(v) > 64:
        raise HTTPException(400, "Bad id")
    return v


async def _json(key: str):
    raw = await state["sources"].redis.get(key)
    return json.loads(raw) if raw else None


@app.get("/api/questions")
async def questions():
    return await state["store"].questions(30)


@app.get("/api/question/{qid}")
async def question(qid: str):
    store: GraphStore = state["store"]
    snap = await store.snapshot(_check_id(qid))
    if not snap.get("question"):
        raise HTTPException(404, "Not researched yet")
    verdicts = {}
    for h in snap["hypotheses"]:
        verdicts[h["key"]] = await _json(f"tg:hyp:{h['key']}:verdict")
    run = await _json(f"tg:q:{qid}:run") or {}
    return {**snap, "verdicts": verdicts, "metrics": await _json(f"tg:q:{qid}:metrics"),
            "stats": run.get("stats"), "flags": run.get("flags", []),
            "disclaimer": get_domain(snap["question"].get("domain", "general")).disclaimer}


@app.get("/api/hypothesis/{key}")
async def hypothesis(key: str):
    h = await state["store"].find_hypothesis(_check_id(key))
    if not h:
        raise HTTPException(404, "Unknown hypothesis")
    return {"hypothesis": to_jsonable(h), "verdict": await _json(f"tg:hyp:{key}:verdict")}


@app.get("/api/benchmarks/{qid}")
async def benchmarks(qid: str):
    return await run_benchmarks(state["store"], _check_id(qid))


@app.get("/api/queries")
async def queries():
    return [{k: q[k] for k in ("id", "title", "question", "hops", "cypher")} for q in QUERIES]


class CypherIn(BaseModel):
    cypher: str = Field(max_length=2000)
    qid: str | None = Field(default=None, max_length=64)


@app.post("/api/query")
async def query(body: CypherIn, request: Request):
    _limit(request, ":q")
    guard = screen_cypher(body.cypher)
    if not guard.ok:
        raise HTTPException(400, guard.message)
    store: GraphStore = state["store"]
    t0 = time.perf_counter()
    try:
        res = await store.ro(guard.value, {"q": body.qid or ""})
    except Exception as e:
        msg = str(e)
        raise HTTPException(400, "Query timed out (3s limit)." if "timed out" in msg.lower() else f"Query error: {msg[:200]}")
    ms = round((time.perf_counter() - t0) * 1000, 2)
    rows = res.result_set[: settings.query_row_limit]
    return {
        "columns": [h[1] if isinstance(h, (list, tuple)) else str(h) for h in res.header],
        "rows": to_jsonable(rows),
        "truncated": len(res.result_set) > settings.query_row_limit,
        "ms": ms,
        "server_ms": getattr(res, "run_time_ms", None),
    }
