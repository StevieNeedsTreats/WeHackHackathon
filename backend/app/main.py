from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .agents.extractor import llm_available
from .agents.metrics import QUERIES, run_benchmarks
from .agents.orchestrator import Run
from .config import get_settings
from .demo import DEMO_SUBSTANCE
from .graph import GraphStore, to_jsonable
from .guardrails import DISCLAIMER, RateLimiter, screen_cypher, screen_substance, substance_key
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


app = FastAPI(title="TruthGraph API", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _client(request: Request) -> str:
    return request.client.host if request.client else "anon"


@app.get("/api/health")
async def health():
    store: GraphStore = state["store"]
    ok = await store.ping()
    counts = await store.counts() if ok else {"nodes": 0, "edges": 0}
    return {
        "falkordb": ok, "graph": settings.graph_name, **counts,
        "extractor": "claude" if llm_available() else "rules",
        "model": settings.extract_model if llm_available() else None,
        "disclaimer": DISCLAIMER,
    }


class ScreenIn(BaseModel):
    q: str = Field(max_length=200)


@app.post("/api/screen")
async def screen(body: ScreenIn):
    r = screen_substance(body.q)
    return {"ok": r.ok, "value": r.value, "code": r.code, "message": r.message, "checks": r.checks}


@app.get("/api/substances")
async def substances():
    return await state["store"].substances()


@app.get("/api/research/stream")
async def research(request: Request, q: str = Query(..., max_length=200), mode: str = Query("live", pattern="^(live|demo)$")):
    if mode == "demo":
        q = DEMO_SUBSTANCE
    guard = screen_substance(q)

    async def refused():
        yield {"event": "guardrail", "data": json.dumps({"ok": False, "code": guard.code, "message": guard.message, "checks": guard.checks})}
        yield {"event": "end", "data": "{}"}

    if not guard.ok:
        return EventSourceResponse(refused())

    allowed, retry = state["limiter"].allow(_client(request))
    if not allowed:
        raise HTTPException(429, f"Rate limit reached. Try again in {int(retry) + 1}s.")

    key = substance_key(guard.value) + ("-demo" if mode == "demo" else "")
    if key in state["active"]:
        raise HTTPException(409, f"“{guard.value}” is already being built. Open it from the sidebar when it finishes.")

    run = Run(state["store"], state["sources"], guard.value, key, mode)

    async def stream():
        yield {"event": "guardrail", "data": json.dumps({"ok": True, "value": guard.value, "checks": guard.checks})}
        async with state["runs"]:
            state["active"].add(key)
            task = asyncio.create_task(run.execute())
            try:
                while True:
                    msg = await run.queue.get()
                    if msg is None:
                        break
                    if await request.is_disconnected():
                        task.cancel()
                        break
                    yield {"event": msg["event"], "data": json.dumps({**{"_t": msg["t"]}, **_wrap(msg["data"])}, default=str)}
            finally:
                state["active"].discard(key)
                if not task.done():
                    task.cancel()
        yield {"event": "end", "data": "{}"}

    return EventSourceResponse(stream(), ping=10)


def _wrap(data):
    return data if isinstance(data, dict) else {"items": data}


@app.get("/api/graph/{key}")
async def graph(key: str):
    store: GraphStore = state["store"]
    if not key.replace("-", "").isalnum() or len(key) > 64:
        raise HTTPException(400, "Bad key")
    snap = await store.snapshot(key)
    if not snap["nodes"]:
        raise HTTPException(404, "Not built yet")
    sub = next(n for n in snap["nodes"] if n["kind"] == "substance")
    extra = {}
    for f in ("insights", "metrics", "stats", "flags"):
        raw = sub.pop(f, None)
        extra[f] = json.loads(raw) if isinstance(raw, str) else None
    return {**snap, **extra, "key": key, "name": sub.get("name")}


@app.get("/api/benchmarks/{key}")
async def benchmarks(key: str):
    return await run_benchmarks(state["store"], key)


@app.get("/api/queries")
async def queries():
    return [{k: q[k] for k in ("id", "title", "question", "hops", "cypher")} for q in QUERIES]


class CypherIn(BaseModel):
    cypher: str = Field(max_length=2000)
    key: str | None = Field(default=None, max_length=64)


@app.post("/api/query")
async def query(body: CypherIn, request: Request):
    allowed, retry = state["limiter"].allow(_client(request) + ":q")
    if not allowed:
        raise HTTPException(429, f"Rate limit reached. Try again in {int(retry) + 1}s.")
    guard = screen_cypher(body.cypher)
    if not guard.ok:
        raise HTTPException(400, guard.message)
    store: GraphStore = state["store"]
    t0 = time.perf_counter()
    try:
        res = await store.ro(guard.value, {"k": body.key or ""})
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
