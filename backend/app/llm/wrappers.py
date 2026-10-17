"""Client wrappers: response cache, recording and replay.

Every call carries a `trace` key naming what it is for (e.g. `extract:pmid:123`).
Recording stores each answer under that key; replay serves it back, which is how
the offline demo runs the real agents without an API key.
"""

from __future__ import annotations

import asyncio

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, AsyncIterator, Callable, TypeVar

from pydantic import BaseModel

from .types import LLMError, Message, ToolCall, ToolSpec, Turn, Usage

T = TypeVar("T", bound=BaseModel)


def _msg_key(messages: list[Message]) -> list:
    return [[m.role, m.text, [[c.name, c.args] for c in m.tool_calls], [[r.content, r.is_error] for r in m.results]]
            for m in messages]


class LimitedClient:
    """Caps requests in flight across every agent sharing the same semaphore."""

    def __init__(self, inner: Any, sem: asyncio.Semaphore):
        self.inner, self.sem = inner, sem
        self.provider, self.model = inner.provider, inner.model

    async def structured(self, **kw):
        async with self.sem:
            return await self.inner.structured(**kw)

    async def chat(self, **kw):
        async with self.sem:
            return await self.inner.chat(**kw)

    async def stream_text(self, **kw):
        async with self.sem:
            async for chunk in self.inner.stream_text(**kw):
                yield chunk


class CachedClient:
    """Caches structured answers in Redis, keyed by the exact request."""

    def __init__(self, inner: Any, redis: Any, ttl_s: int):
        self.inner, self.redis, self.ttl_s = inner, redis, ttl_s
        self.provider, self.model = inner.provider, inner.model

    def _key(self, system: str, messages: list[Message], schema: type[BaseModel]) -> str:
        blob = json.dumps([self.provider, self.model, system, _msg_key(messages), schema.__name__,
                           schema.model_json_schema()], sort_keys=True, default=str)
        return "tg:llm:" + hashlib.sha256(blob.encode()).hexdigest()

    async def structured(self, *, system, messages, schema: type[T], trace, max_tokens=8000, effort=None):
        key = self._key(system, messages, schema)
        try:
            hit = await self.redis.get(key)
        except Exception:
            hit = None
        if hit:
            return schema.model_validate_json(hit), Usage()
        value, usage = await self.inner.structured(system=system, messages=messages, schema=schema, trace=trace,
                                                   max_tokens=max_tokens, effort=effort)
        try:
            await self.redis.set(key, value.model_dump_json(), ex=self.ttl_s)
        except Exception:
            pass
        return value, usage

    async def chat(self, **kw) -> Turn:
        return await self.inner.chat(**kw)

    def stream_text(self, **kw) -> AsyncIterator[str]:
        return self.inner.stream_text(**kw)


class Fixtures:
    """A JSON file of recorded answers keyed by trace."""

    def __init__(self, path: str | Path, data: dict | None = None):
        self.path = Path(path)
        self.data: dict[str, Any] = data if data is not None else (
            json.loads(self.path.read_text()) if self.path.exists() else {})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(self.data, f, indent=1, ensure_ascii=False, sort_keys=True)
        os.replace(tmp, self.path)


class RecordingClient:
    def __init__(self, inner: Any, fixtures: Fixtures):
        self.inner, self.fx = inner, fixtures
        self.provider, self.model = inner.provider, inner.model
        self._steps: dict[str, int] = {}

    def _step(self, trace: str) -> str:
        n = self._steps.get(trace, 0)
        self._steps[trace] = n + 1
        return f"{trace}#{n}"

    async def structured(self, *, system, messages, schema, trace, max_tokens=8000, effort=None):
        value, usage = await self.inner.structured(system=system, messages=messages, schema=schema, trace=trace,
                                                   max_tokens=max_tokens, effort=effort)
        self.fx.data[trace] = value.model_dump(mode="json")
        self.fx.save()
        return value, usage

    async def chat(self, *, system, messages, tools, trace, max_tokens=8000, effort=None) -> Turn:
        turn = await self.inner.chat(system=system, messages=messages, tools=tools, trace=trace,
                                     max_tokens=max_tokens, effort=effort)
        self.fx.data[self._step(trace)] = {"text": turn.text, "tool_calls": [[c.name, c.args] for c in turn.tool_calls]}
        self.fx.save()
        return turn

    async def stream_text(self, *, system, messages, trace, max_tokens=2000, effort=None, on_usage=None):
        parts: list[str] = []
        async for d in self.inner.stream_text(system=system, messages=messages, trace=trace,
                                              max_tokens=max_tokens, effort=effort, on_usage=on_usage):
            parts.append(d)
            yield d
        self.fx.data[trace] = "".join(parts)
        self.fx.save()


class ReplayClient:
    """Serves recorded answers. Unknown traces are an error, never a guess."""

    provider = "replay"

    def __init__(self, fixtures: Fixtures, model: str = "replay"):
        self.fx, self.model = fixtures, model
        self._steps: dict[str, int] = {}

    def _get(self, key: str) -> Any:
        if key not in self.fx.data:
            raise LLMError(f"no recorded answer for {key!r}")
        return self.fx.data[key]

    async def structured(self, *, system, messages, schema: type[T], trace, max_tokens=8000, effort=None):
        return schema.model_validate(self._get(trace)), Usage(calls=1)

    async def chat(self, *, system, messages, tools: list[ToolSpec], trace, max_tokens=8000, effort=None) -> Turn:
        n = self._steps.get(trace, 0)
        self._steps[trace] = n + 1
        rec = self._get(f"{trace}#{n}")
        calls = [ToolCall(f"r{n}_{i}", name, args) for i, (name, args) in enumerate(rec.get("tool_calls", []))]
        return Turn(rec.get("text", ""), calls, "tool_use" if calls else "end_turn", Usage(calls=1))

    async def stream_text(self, *, system, messages, trace, max_tokens=2000, effort=None,
                          on_usage: Callable[[Usage], None] | None = None):
        text = self._get(trace)
        for i in range(0, len(text), 24):
            yield text[i:i + 24]
