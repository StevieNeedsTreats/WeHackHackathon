"""Any OpenAI-compatible Chat Completions endpoint.

Covers OpenAI, OpenRouter, Groq, Together, vLLM, LM Studio and Ollama
(`base_url=http://localhost:11434/v1`). Plain HTTP, so no extra SDK is needed.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from typing import Any, AsyncIterator, Callable, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .base import schema_of
from .types import LLMError, LLMRefusal, Message, ToolCall, ToolSpec, Turn, Usage, price

T = TypeVar("T", bound=BaseModel)


class OpenAICompatClient:
    provider = "openai"

    def __init__(self, model: str, api_key: str | None, base_url: str, timeout_s: float = 120.0):
        self.model = model
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self.http = httpx.AsyncClient(base_url=base_url.rstrip("/"), headers=headers, timeout=timeout_s)

    # ------------------------------------------------------------------ conversion

    @staticmethod
    def _messages(system: str, messages: list[Message]) -> list[dict]:
        out: list[dict] = [{"role": "system", "content": system}] if system else []
        for m in messages:
            if m.role == "user":
                out.append({"role": "user", "content": m.text})
            elif m.role == "assistant":
                msg: dict[str, Any] = {"role": "assistant", "content": m.text or None}
                if m.tool_calls:
                    msg["tool_calls"] = [
                        {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.args)}}
                        for c in m.tool_calls
                    ]
                out.append(msg)
            else:
                out += [{"role": "tool", "tool_call_id": r.call_id, "content": r.content} for r in m.results]
        return out

    def _usage(self, data: dict) -> Usage:
        u = data.get("usage") or {}
        i, o = int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
        return Usage(i, o, price(self.model, i, o), 1)

    async def _post(self, body: dict) -> dict:
        last: Exception | None = None
        for attempt in range(6):
            wait = 0.8 * (2**attempt)
            try:
                r = await self.http.post("/chat/completions", json=body)
                if r.status_code == 429:
                    # Per-minute token limits: wait as long as the provider asks, not a fixed backoff.
                    wait = _retry_after(r) or wait
                    raise LLMError(f"429: {r.text[:200]}")
                if r.status_code >= 500:
                    raise LLMError(f"{r.status_code}: {r.text[:200]}")
                if r.status_code >= 400:
                    raise _BadRequest(f"{r.status_code}: {r.text[:300]}")
                return r.json()
            except _BadRequest:
                raise
            except (httpx.HTTPError, LLMError, ValueError) as e:
                last = e
                if attempt < 5:
                    await asyncio.sleep(min(wait, 60) + random.uniform(0, 0.5))
        raise LLMError(f"openai-compatible endpoint failed: {last}")

    @staticmethod
    def _choice(data: dict) -> dict:
        choices = data.get("choices") or []
        if not choices:
            raise LLMError("empty response")
        c = choices[0]
        if c.get("finish_reason") == "content_filter" or (c.get("message") or {}).get("refusal"):
            raise LLMRefusal("model declined")
        return c

    # ------------------------------------------------------------------ calls

    async def structured(self, *, system: str, messages: list[Message], schema: type[T], trace: str,
                         max_tokens: int = 8000, effort: str | None = None) -> tuple[T, Usage]:
        js = schema_of(schema)
        base = {"model": self.model, "max_tokens": max_tokens, "messages": self._messages(system, messages)}
        usage = Usage()
        formats = [
            {"type": "json_schema", "json_schema": {"name": schema.__name__, "schema": js}},
            {"type": "json_object"},
        ]
        hint = f"\n\nReply with one JSON object matching this JSON schema:\n{json.dumps(js)}"
        for i, fmt in enumerate(formats):
            body = dict(base, response_format=fmt)
            if i == 1:
                body["messages"] = self._messages(system + hint, messages)
            try:
                data = await self._post(body)
            except _BadRequest:
                continue  # endpoint doesn't support this response_format; try the next
            usage.add(self._usage(data))
            text = (self._choice(data).get("message") or {}).get("content") or ""
            try:
                return schema.model_validate_json(_strip_fences(text)), usage
            except ValidationError as e:
                # One repair round with the validation error.
                body["messages"] = body["messages"] + [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": f"That JSON did not validate: {str(e)[:800]}. Reply with corrected JSON only."},
                ]
                data = await self._post(body)
                usage.add(self._usage(data))
                text = (self._choice(data).get("message") or {}).get("content") or ""
                try:
                    return schema.model_validate_json(_strip_fences(text)), usage
                except ValidationError as e2:
                    raise LLMError(f"structured output did not validate: {str(e2)[:300]}") from e2
        raise LLMError("endpoint rejected every structured-output format")

    async def chat(self, *, system: str, messages: list[Message], tools: list[ToolSpec], trace: str,
                   max_tokens: int = 8000, effort: str | None = None) -> Turn:
        body = {
            "model": self.model, "max_tokens": max_tokens, "messages": self._messages(system, messages),
            "tools": [{"type": "function", "function": {"name": t.name, "description": t.description,
                                                        "parameters": t.parameters}} for t in tools],
            "tool_choice": "auto",
        }
        try:
            data = await self._post(body)
        except _BadRequest as e:
            raise LLMError(str(e)) from e
        c = self._choice(data)
        msg = c.get("message") or {}
        calls = []
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except ValueError:
                args = {"_invalid_json": fn.get("arguments")}
            calls.append(ToolCall(tc.get("id") or f"call_{len(calls)}", fn.get("name", ""), args if isinstance(args, dict) else {}))
        stop = "tool_use" if calls else (c.get("finish_reason") or "stop")
        return Turn(msg.get("content") or "", calls, stop, self._usage(data))

    async def stream_text(self, *, system: str, messages: list[Message], trace: str,
                          max_tokens: int = 2000, effort: str | None = None,
                          on_usage: Callable[[Usage], None] | None = None) -> AsyncIterator[str]:
        body = {"model": self.model, "max_tokens": max_tokens, "messages": self._messages(system, messages),
                "stream": True, "stream_options": {"include_usage": True}}
        try:
            async with self.http.stream("POST", "/chat/completions", json=body) as r:
                if r.status_code >= 400:
                    raise LLMError(f"{r.status_code}: {(await r.aread())[:200]!r}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except ValueError:
                        continue
                    if chunk.get("usage") and on_usage:
                        on_usage(self._usage(chunk))
                    for ch in chunk.get("choices") or []:
                        delta = (ch.get("delta") or {}).get("content")
                        if delta:
                            yield delta
        except httpx.HTTPError as e:
            raise LLMError(f"stream failed: {e}") from e


class _BadRequest(LLMError):
    pass


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    start, end = t.find("{"), t.rfind("}")
    return t[start:end + 1] if start != -1 and end > start else t


def _retry_after(r: httpx.Response) -> float | None:
    """Seconds to wait from a 429: the retry-after header, or 'try again in 7.5s' / '1m2.5s' in the body."""
    h = r.headers.get("retry-after")
    if h:
        try:
            return float(h)
        except ValueError:
            pass
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)(ms|s)", r.text)
    if m:
        secs = float(m.group(2)) / (1000 if m.group(3) == "ms" else 1)
        return secs + 60 * int(m.group(1) or 0)
    return None
