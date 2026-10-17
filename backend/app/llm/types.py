"""Provider-neutral message, tool and usage types.

Agents only ever speak these types. Each adapter converts them to its provider's
wire format, so swapping the model never touches agent code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal


class LLMError(RuntimeError):
    """The provider failed or returned something unusable."""


class LLMRefusal(LLMError):
    """The model declined the request."""


class LLMUnavailable(LLMError):
    """No credentials or endpoint are configured for the selected provider."""


class ToolsUnsupported(LLMError):
    """The endpoint rejected a request because it has tools; agents fall back to structured calls."""


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]


@dataclass
class ToolResult:
    call_id: str
    content: str
    is_error: bool = False


@dataclass
class Message:
    """One conversation entry.

    `raw` keeps the provider's own assistant content (thinking blocks included) so
    it can be sent back unchanged on the next turn of the same conversation.
    """

    role: Literal["user", "assistant", "tool"]
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    results: list[ToolResult] = field(default_factory=list)
    raw: Any = None

    @staticmethod
    def user(text: str) -> "Message":
        return Message("user", text=text)


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[Any]] | None = None


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    calls: int = 0

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cost_usd += other.cost_usd
        self.calls += other.calls

    def as_dict(self) -> dict[str, Any]:
        return {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
                "cost_usd": round(self.cost_usd, 5), "calls": self.calls}


@dataclass
class Turn:
    """One assistant step: text and/or tool calls."""

    text: str
    tool_calls: list[ToolCall]
    stop_reason: str
    usage: Usage
    raw: Any = None

    def as_message(self) -> Message:
        return Message("assistant", text=self.text, tool_calls=self.tool_calls, raw=self.raw)


# USD per million tokens (input, output). Unknown models are tracked by tokens only.
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-fable-5-1": (10.00, 50.00),
}


def price(model: str, input_tokens: int, output_tokens: int) -> float:
    p_in, p_out = PRICES.get(model, (0.0, 0.0))
    return (input_tokens * p_in + output_tokens * p_out) / 1_000_000


class UsageMeter:
    """Accumulates token use per agent for one run and enforces the run budget."""

    def __init__(self, token_budget: int | None = None):
        self.by_agent: dict[str, Usage] = {}
        self.token_budget = token_budget

    def record(self, agent: str, usage: Usage) -> None:
        self.by_agent.setdefault(agent, Usage()).add(usage)

    @property
    def total(self) -> Usage:
        t = Usage()
        for u in self.by_agent.values():
            t.add(u)
        return t

    def exhausted(self) -> bool:
        if not self.token_budget:
            return False
        t = self.total
        return t.input_tokens + t.output_tokens >= self.token_budget

    def as_dict(self) -> dict[str, Any]:
        return {"total": self.total.as_dict(), "agents": {k: v.as_dict() for k, v in self.by_agent.items()}}
