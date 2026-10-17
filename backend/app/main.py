from __future__ import annotations

import asyncio
import hashlib
import json
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from redis.exceptions import RedisError
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
    state["live"] = {}  # qid -> LiveRun
    yield
    for live in list(state["live"].values()):
        live.task.cancel()
    await state["sources"].close()


app = FastAPI(title="TruthGraph API", version="2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "DELETE"],
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


def _question_id(q: dict) -> str:
    return hashlib.sha1((q["domain"] + "|" + "|".join(sorted(h["key"] for h in q["hypotheses"]))).encode()).hexdigest()[:10]


async def _known_concepts(q: dict) -> dict:
    """Swap each concept for one already in the graph under another name (matched through
    synonyms), so a reworded hypothesis gets the same key and reuses earlier research."""
    roles = ("subject", "outcome", "population")
    found = await state["store"].resolve_concepts([h[r] for h in q["hypotheses"] for r in roles if h.get(r)])
    if not found:
        return q
    seen, hyps = set(), []
    for h in q["hypotheses"]:
        for r in roles:
            if h.get(r) and h[r]["id"] in found:
                h[r] = {**h[r], **found[h[r]["id"]]}
        h["key"] = hypothesis_key(q["domain"], h["subject"], h["outcome"], h["population"])
        if h["key"] not in seen:
            seen.add(h["key"])
            hyps.append(h)
    q["hypotheses"] = hyps
    q["id"] = _question_id(q)
    return q


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
    if not bundle:  # demo bundles replay answers recorded under the original keys
        q = await _known_concepts(q)
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
    except RedisError as e:  # FalkorDB is a Redis server; its client raises Redis errors
        raise HTTPException(503, f"The evidence graph is unavailable: {e}"[:300])
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
    q["id"] = _question_id(q)
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
    except RedisError as e:
        return EventSourceResponse(refused({"ok": False, "code": "graph-unavailable",
                                            "message": f"The evidence graph is unavailable: {e}"[:300]}))
    if not interp["ok"]:
        return EventSourceResponse(refused(interp))

    question = interp["question"] if bundle else _merge_edits(interp["question"], edits)
    if bundle:
        question["fresh"] = True
    qid = question["id"]
    if qid in state["live"]:
        # Already running (another tab, or asked twice): watch that run instead of starting a second.
        return EventSourceResponse(state["live"][qid].follow(request), ping=10)

    run = Run(state["store"], state["sources"], router, question, mode,
              search=bundle.search if bundle else None, fulltext=bundle.fulltext if bundle else None,
              cites=bundle.cites if bundle else None, pace=1.0 if bundle else 0.0)
    live = LiveRun(qid, run, [
        {"event": "guardrail", "data": json.dumps({"ok": True, "checks": interp["checks"]})},
        {"event": "interpretation", "data": json.dumps({k: interp[k] for k in ("question", "notice", "disclaimer",
                                                                                "domain")}, default=str)},
    ])
    return EventSourceResponse(live.follow(request), ping=10)


class LiveRun:
    """A research run owned by the server, not by the browser that started it.

    Closing the tab or opening another question only detaches that viewer; the run keeps
    going. Every event is kept, so a viewer that attaches later replays the run so far and
    then follows it live. Only an explicit stop cancels it.
    """

    def __init__(self, qid: str, run: Run, preamble: list[dict]):
        self.qid, self.run = qid, run
        self.events: list[dict] = list(preamble)
        self.done = False
        self._changed = asyncio.Event()
        state["live"][qid] = self
        self.task = asyncio.create_task(self._main())

    async def _main(self) -> None:
        try:
            async with state["runs"]:
                work = asyncio.create_task(self.run.execute())
                try:
                    while (msg := await self.run.queue.get()) is not None:
                        data = msg["data"] if isinstance(msg["data"], dict) else {"items": msg["data"]}
                        self._push({"event": msg["event"], "data": json.dumps({"_t": msg["t"], **data}, default=str)})
                finally:
                    if not work.done():
                        work.cancel()
        finally:
            self.done = True
            state["live"].pop(self.qid, None)
            self._wake()

    def _push(self, ev: dict) -> None:
        self.events.append(ev)
        self._wake()

    def _wake(self) -> None:
        self._changed.set()
        self._changed = asyncio.Event()

    def stop(self) -> None:
        self._push({"event": "error", "data": json.dumps({"code": "stopped",
                                                          "message": "Research stopped. Partial results are saved."})})
        self.task.cancel()

    async def follow(self, request: Request):
        """Replay everything so far, then stream new events until the run ends or the viewer leaves."""
        i = 0
        while True:
            while i < len(self.events):
                yield self.events[i]
                i += 1
            if self.done:
                break
            changed = self._changed
            try:
                await asyncio.wait_for(changed.wait(), 15)
            except TimeoutError:
                pass
            if await request.is_disconnected():
                return  # the viewer left; the run carries on
        yield {"event": "end", "data": "{}"}


@app.get("/api/research/attach")
async def attach(request: Request, qid: str = Query(..., max_length=64)):
    """Watch a run that is already going: replays what happened so far, then follows it live."""
    live = state["live"].get(_check_id(qid))
    if not live:
        raise HTTPException(404, "That question isn't being researched right now.")
    return EventSourceResponse(live.follow(request), ping=10)


@app.post("/api/research/stop")
async def stop(qid: str = Query(..., max_length=64)):
    live = state["live"].get(_check_id(qid))
    if not live:
        raise HTTPException(404, "That question isn't being researched right now.")
    live.stop()
    return {"stopped": qid}


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
    qs = await state["store"].questions(30)
    for q in qs:
        q["running"] = q["id"] in state["live"]
    return qs


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
            "stats": run.get("stats"), "flags": run.get("flags", []), "running": qid in state["live"],
            "disclaimer": get_domain(snap["question"].get("domain", "general")).disclaimer}


@app.delete("/api/question/{qid}")
async def delete_question(qid: str, request: Request):
    _limit(request, ":d")
    if _check_id(qid) in state["live"]:
        raise HTTPException(409, "That question is still being researched. Stop it first.")
    store: GraphStore = state["store"]
    exists = await store.ro("MATCH (q:Question {id:$id}) RETURN q.id", {"id": qid})
    if not exists.result_set:
        raise HTTPException(404, "Unknown question")
    keys = await store.delete_question(qid)
    redis = state["sources"].redis
    await redis.delete(f"tg:q:{qid}:run", f"tg:q:{qid}:metrics", *[f"tg:hyp:{k}:verdict" for k in keys])
    return {"deleted": qid, "hypotheses": keys}


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
