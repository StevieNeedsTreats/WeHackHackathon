"""The one interface every agent uses to talk to a model."""

from __future__ import annotations

from typing import AsyncIterator, Callable, Protocol, TypeVar

from pydantic import BaseModel

from .types import Message, ToolSpec, Turn, Usage

T = TypeVar("T", bound=BaseModel)


class LLMClient(Protocol):
    provider: str
    model: str

    async def structured(self, *, system: str, messages: list[Message], schema: type[T],
                         trace: str, max_tokens: int = 8000, effort: str | None = None) -> tuple[T, Usage]:
        """One call whose answer is validated against `schema`."""
        ...

    async def chat(self, *, system: str, messages: list[Message], tools: list[ToolSpec],
                   trace: str, max_tokens: int = 8000, effort: str | None = None) -> Turn:
        """One assistant step that may call tools. The caller runs the loop."""
        ...

    def stream_text(self, *, system: str, messages: list[Message], trace: str,
                    max_tokens: int = 2000, effort: str | None = None,
                    on_usage: Callable[[Usage], None] | None = None) -> AsyncIterator[str]:
        """Plain text, streamed as it is generated."""
        ...


def schema_of(model: type[BaseModel]) -> dict:
    """JSON schema for a Pydantic model, inlined so every provider accepts it."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def inline(node):
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].rsplit("/", 1)[-1]
                return inline(dict(defs[name]))
            return {k: inline(v) for k, v in node.items()}
        if isinstance(node, list):
            return [inline(x) for x in node]
        return node

    return inline(schema)
