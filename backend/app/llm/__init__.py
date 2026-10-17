"""Swappable LLM access.

    llm = LLMRouter.live(redis)            # per-agent clients from TG_* settings
    llm = LLMRouter.replay(fixtures)       # recorded answers, no network
    value, usage = await llm.for_agent("extractor").structured(...)

Pick a provider with TG_LLM_PROVIDER (anthropic | openai), a default model with
TG_LLM_MODEL, and override any agent with TG_MODEL_<AGENT>.
"""

from __future__ import annotations

import os
import asyncio
from pathlib import Path
from typing import Any

from ..config import get_settings
from .base import LLMClient, schema_of
from .types import (LLMError, LLMRefusal, LLMUnavailable, Message, ToolCall, ToolResult, ToolSpec, ToolsUnsupported,
                    Turn, Usage, UsageMeter)
from .wrappers import CachedClient, Fixtures, LimitedClient, RecordingClient, ReplayClient

__all__ = [
    "LLMClient", "LLMError", "LLMRefusal", "LLMRouter", "LLMUnavailable", "Message", "ToolCall", "ToolResult",
    "ToolSpec", "ToolsUnsupported", "Turn", "Usage", "UsageMeter", "Fixtures", "schema_of", "llm_status",
]

AGENTS = ("orchestrator", "intake", "discovery", "extractor", "credibility", "stance", "contradictions", "verdict")
STRONG_DEFAULTS = {"anthropic": {"orchestrator": "claude-sonnet-5-5"}}


def _api_key() -> str | None:
    s = get_settings()
    if s.llm_api_key:
        return s.llm_api_key
    if s.llm_provider == "anthropic":
        return s.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
    return os.environ.get("OPENAI_API_KEY")


def model_for(agent: str) -> str:
    s = get_settings()
    override = getattr(s, f"model_{agent}", None)
    if override:
        return override
    return STRONG_DEFAULTS.get(s.llm_provider, {}).get(agent, s.llm_model)


def llm_status() -> dict[str, Any]:
    """Whether live LLM calls can be made, and with what."""
    s = get_settings()
    if s.llm_provider == "anthropic":
        ok = bool(_api_key() or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                  or (Path.home() / ".config" / "anthropic").exists())
    elif s.llm_provider == "openai":
        ok = bool(_api_key() or s.llm_base_url)
    else:
        ok = False
    return {"available": ok, "provider": s.llm_provider, "models": {a: model_for(a) for a in AGENTS}}


def _make(model: str) -> Any:
    s = get_settings()
    if s.llm_provider == "anthropic":
        from .anthropic_client import AnthropicClient

        return AnthropicClient(model, api_key=_api_key(), base_url=s.llm_base_url)
    if s.llm_provider == "openai":
        from .openai_compat import OpenAICompatClient

        return OpenAICompatClient(model, _api_key(), s.llm_base_url or "https://api.openai.com/v1")
    raise LLMUnavailable(f"unknown provider {s.llm_provider!r}")


class LLMRouter:
    """Hands each agent its client. One router per run."""

    def __init__(self, clients: dict[str, Any], default: Any, mode: str):
        self._clients, self._default, self.mode = clients, default, mode

    def for_agent(self, agent: str) -> Any:
        return self._clients.get(agent, self._default)

    @classmethod
    def live(cls, redis: Any = None) -> "LLMRouter":
        s = get_settings()
        if not llm_status()["available"]:
            raise LLMUnavailable(
                "No LLM is configured. Set ANTHROPIC_API_KEY (or TG_LLM_PROVIDER=openai with TG_LLM_BASE_URL / "
                "OPENAI_API_KEY), or use the demo.")
        record = Fixtures(s.llm_record) if s.llm_record else None
        sem = asyncio.Semaphore(max(1, s.llm_concurrency))
        built: dict[str, Any] = {}
        clients: dict[str, Any] = {}
        for agent in AGENTS:
            model = model_for(agent)
            if model not in built:
                c = LimitedClient(_make(model), sem)
                if redis is not None:
                    c = CachedClient(c, redis, s.cache_ttl_s)
                built[model] = c
            clients[agent] = RecordingClient(built[model], record) if record else built[model]
        return cls(clients, clients["extractor"], "live")

    @classmethod
    def replay(cls, fixtures: Fixtures) -> "LLMRouter":
        client = ReplayClient(fixtures)
        return cls({}, client, "replay")
