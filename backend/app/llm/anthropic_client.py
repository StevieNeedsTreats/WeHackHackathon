"""Claude through the official Anthropic SDK."""

from __future__ import annotations

from typing import Any, AsyncIterator, Callable, TypeVar

import anthropic
from pydantic import BaseModel

from .types import LLMError, LLMRefusal, Message, ToolCall, ToolSpec, Turn, Usage, price

T = TypeVar("T", bound=BaseModel)


class AnthropicClient:
    provider = "anthropic"

    def __init__(self, model: str, api_key: str | None = None, base_url: str | None = None):
        self.model = model
        kwargs: dict[str, Any] = {"max_retries": 3}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        self.client = anthropic.AsyncAnthropic(**kwargs)

    # ------------------------------------------------------------------ conversion

    @staticmethod
    def _messages(messages: list[Message]) -> list[dict]:
        out: list[dict] = []
        for m in messages:
            if m.role == "user":
                out.append({"role": "user", "content": m.text})
            elif m.role == "assistant":
                if m.raw is not None:
                    out.append({"role": "assistant", "content": m.raw})
                    continue
                blocks: list[dict] = [{"type": "text", "text": m.text}] if m.text else []
                blocks += [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.args} for c in m.tool_calls]
                out.append({"role": "assistant", "content": blocks})
            else:
                out.append({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": r.call_id, "content": r.content, "is_error": r.is_error}
                    for r in m.results
                ]})
        return out

    def _usage(self, u: Any) -> Usage:
        i, o = getattr(u, "input_tokens", 0) or 0, getattr(u, "output_tokens", 0) or 0
        return Usage(i, o, price(self.model, i, o), 1)

    @staticmethod
    def _config(effort: str | None) -> dict:
        return {"output_config": {"effort": effort}} if effort else {}

    @staticmethod
    def _check(resp: Any) -> None:
        if resp.stop_reason == "refusal":
            details = getattr(resp, "stop_details", None)
            raise LLMRefusal(f"model declined ({getattr(details, 'category', None) or 'unspecified'})")

    # ------------------------------------------------------------------ calls

    async def structured(self, *, system: str, messages: list[Message], schema: type[T], trace: str,
                         max_tokens: int = 8000, effort: str | None = None) -> tuple[T, Usage]:
        try:
            resp = await self.client.messages.parse(
                model=self.model, max_tokens=max_tokens, system=system,
                messages=self._messages(messages), output_format=schema, **self._config(effort),
            )
        except anthropic.APIStatusError as e:
            raise LLMError(f"anthropic {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError(f"anthropic connection error: {e}") from e
        self._check(resp)
        if resp.parsed_output is None:
            raise LLMError(f"no structured output (stop_reason={resp.stop_reason})")
        return resp.parsed_output, self._usage(resp.usage)

    async def chat(self, *, system: str, messages: list[Message], tools: list[ToolSpec], trace: str,
                   max_tokens: int = 8000, effort: str | None = None) -> Turn:
        try:
            resp = await self.client.messages.create(
                model=self.model, max_tokens=max_tokens, system=system,
                messages=self._messages(messages),
                tools=[{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools],
                **self._config(effort),
            )
        except anthropic.APIStatusError as e:
            raise LLMError(f"anthropic {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError(f"anthropic connection error: {e}") from e
        self._check(resp)
        text = "".join(b.text for b in resp.content if b.type == "text")
        calls = [ToolCall(b.id, b.name, dict(b.input or {})) for b in resp.content if b.type == "tool_use"]
        raw = [b.to_dict() for b in resp.content]
        return Turn(text, calls, resp.stop_reason or "", self._usage(resp.usage), raw)

    async def stream_text(self, *, system: str, messages: list[Message], trace: str,
                          max_tokens: int = 2000, effort: str | None = None,
                          on_usage: Callable[[Usage], None] | None = None) -> AsyncIterator[str]:
        try:
            async with self.client.messages.stream(
                model=self.model, max_tokens=max_tokens, system=system,
                messages=self._messages(messages), **self._config(effort),
            ) as stream:
                async for delta in stream.text_stream:
                    yield delta
                final = await stream.get_final_message()
                self._check(final)
                if on_usage:
                    on_usage(self._usage(final.usage))
        except anthropic.APIStatusError as e:
            raise LLMError(f"anthropic {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError(f"anthropic connection error: {e}") from e

