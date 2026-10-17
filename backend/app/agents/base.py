"""Agent base: a system prompt, optional tools, a validated output and a step budget.

Two ways to run:
  * `ask`  — one structured call (workers that need no tools).
  * `loop` — a tool-use loop that ends when the model calls `submit_result` with an
             answer that validates against the output schema.
Every tool call is streamed to the browser as an `agent_step` event.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, TypeVar

from pydantic import BaseModel, ValidationError

from ..llm import LLMError, LLMRouter, Message, ToolResult, ToolSpec, UsageMeter, schema_of

T = TypeVar("T", bound=BaseModel)

Emit = Callable[[str, dict], Awaitable[None]]


class BudgetExceeded(LLMError):
    pass


@dataclass
class AgentContext:
    llm: LLMRouter
    meter: UsageMeter
    emit: Emit
    extra: dict[str, Any] = field(default_factory=dict)


def _clip(v: Any, n: int = 6000) -> str:
    s = v if isinstance(v, str) else json.dumps(v, default=str, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + f"… [{len(s) - n} more chars]"


class Agent:
    name: str = "agent"
    system: str = ""
    effort: str | None = "low"
    max_tokens: int = 8000
    max_steps: int = 8

    def _client(self, ctx: AgentContext):
        if ctx.meter.exhausted():
            raise BudgetExceeded("run token budget exhausted")
        return ctx.llm.for_agent(self.name)

    async def ask(self, ctx: AgentContext, prompt: str, schema: type[T], trace: str) -> T:
        value, usage = await self._client(ctx).structured(
            system=self.system, messages=[Message.user(prompt)], schema=schema, trace=trace,
            max_tokens=self.max_tokens, effort=self.effort,
        )
        ctx.meter.record(self.name, usage)
        await ctx.emit("usage", {"agent": self.name, **ctx.meter.by_agent[self.name].as_dict()})
        return value

    async def stream(self, ctx: AgentContext, prompt: str, trace: str, max_tokens: int = 1200) -> AsyncIterator[str]:
        client = self._client(ctx)
        async for delta in client.stream_text(system=self.system, messages=[Message.user(prompt)], trace=trace,
                                              max_tokens=max_tokens, effort=self.effort,
                                              on_usage=lambda u: ctx.meter.record(self.name, u)):
            yield delta

    async def loop(self, ctx: AgentContext, prompt: str, schema: type[T], tools: list[ToolSpec], trace: str,
                   tag: str | None = None) -> T:
        submit = ToolSpec("submit_result", "Submit your final answer. Call it exactly once, when you are done.",
                          schema_of(schema))
        specs = tools + [submit]
        handlers = {t.name: t.handler for t in tools}
        messages = [Message.user(prompt + "\n\nWhen you are done, call submit_result with your final answer.")]
        nudged = False

        for _ in range(self.max_steps):
            turn = await self._client(ctx).chat(system=self.system, messages=messages, tools=specs, trace=trace,
                                                max_tokens=self.max_tokens, effort=self.effort)
            ctx.meter.record(self.name, turn.usage)
            await ctx.emit("usage", {"agent": self.name, **ctx.meter.by_agent[self.name].as_dict()})
            messages.append(turn.as_message())
            if turn.text.strip():
                await ctx.emit("agent_step", {"agent": self.name, "hypothesis": tag, "kind": "note",
                                              "text": turn.text.strip()[:400]})
            if not turn.tool_calls:
                if nudged:
                    break
                nudged = True
                messages.append(Message.user("Call submit_result now with your final answer."))
                continue

            final: T | None = None

            async def run(call) -> ToolResult:
                nonlocal final
                if call.name == "submit_result":
                    try:
                        final = schema.model_validate(call.args)
                        return ToolResult(call.id, "accepted")
                    except ValidationError as e:
                        return ToolResult(call.id, f"Invalid result: {str(e)[:1500]}", True)
                handler = handlers.get(call.name)
                if handler is None:
                    return ToolResult(call.id, f"Unknown tool {call.name}", True)
                await ctx.emit("agent_step", {"agent": self.name, "hypothesis": tag, "kind": "tool",
                                              "tool": call.name, "args": _clip(call.args, 300)})
                try:
                    out = await handler(call.args)
                    return ToolResult(call.id, _clip(out))
                except BudgetExceeded:
                    raise
                except Exception as e:  # tool failures go back to the model, not up the stack
                    return ToolResult(call.id, f"{type(e).__name__}: {str(e)[:500]}", True)

            results = await asyncio.gather(*(run(c) for c in turn.tool_calls))
            messages.append(Message("tool", results=list(results)))
            if final is not None:
                return final

        # Out of steps without a valid submission: ask once more for just the answer.
        transcript = "\n".join(
            (f"[{m.role}] {m.text}" if m.role != "tool" else "\n".join(f"[tool result] {r.content[:1500]}" for r in m.results))
            for m in messages
        )
        return await self.ask(ctx, f"{prompt}\n\nWork so far:\n{_clip(transcript, 30000)}\n\nGive your final answer.",
                              schema, trace + ":final")
