from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TG_", extra="ignore")

    falkor_host: str = "localhost"
    falkor_port: int = 6380
    graph_name: str = "truthgraph"
    # FalkorDB Cloud: the instance's public "host:port" and its credentials. When set, they
    # replace falkor_host/falkor_port.
    db_instance: str | None = None
    db_user: str | None = None
    db_pass: str | None = None
    db_tls: bool = False
    # Redis for side storage (caches, abstracts, verdicts, run logs), kept apart from the graph.
    # Defaults to the docker compose service; use "rediss://user:pass@host:port" for a hosted one.
    redis_url: str = "redis://localhost:6381"

    def db_conn(self) -> dict:
        """Connection kwargs for the graph client."""
        host, port = self.falkor_host, self.falkor_port
        if self.db_instance:
            host, _, p = self.db_instance.removeprefix("redis://").removeprefix("rediss://").rpartition(":")
            port = int(p)
        return {"host": host, "port": port, "username": self.db_user or None, "password": self.db_pass or None,
                "ssl": self.db_tls, "socket_keepalive": True, "health_check_interval": 30}

    # LLM provider. "anthropic" uses the Anthropic SDK; "openai" is any OpenAI-compatible
    # endpoint (OpenAI, OpenRouter, Groq, vLLM, Ollama…) selected with llm_base_url.
    llm_provider: str = "anthropic"
    llm_model: str = "claude-haiku-5-5"
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    anthropic_api_key: str | None = None  # kept for backwards compatibility
    # Record every live answer to this fixture file (for offline replay later).
    llm_record: str | None = None

    # Per-agent model overrides; unset agents use llm_model. The orchestrator plans and
    # judges coverage, so it gets a stronger model by default when on Anthropic.
    model_orchestrator: str | None = None
    model_intake: str | None = None
    model_discovery: str | None = None
    model_extractor: str | None = None
    model_credibility: str | None = None
    model_stance: str | None = None
    model_contradictions: str | None = None
    model_verdict: str | None = None
    model_chat: str | None = None  # graph chat; defaults to the strongest model on Anthropic

    # Run budgets.
    max_hypotheses: int = 3
    max_papers: int = 12  # per hypothesis
    paper_concurrency: int = 6
    # Max LLM requests in flight per run; set to 1 for a local server that serves one at a time.
    llm_concurrency: int = 8
    orchestrator_max_steps: int = 24
    run_token_budget: int = 600_000
    run_timeout_s: int = 420

    fulltext: bool = False
    contact_email: str | None = None  # sent to OpenAlex's polite pool when set

    http_timeout_s: float = 12.0
    cache_ttl_s: int = 60 * 60 * 24 * 7

    rate_limit_per_min: int = 12
    max_concurrent_runs: int = 4
    query_timeout_ms: int = 3000
    query_row_limit: int = 500

    cors_origins: list[str] = ["http://localhost:3100", "http://127.0.0.1:3100"]

    # "production" hides the interactive API docs and refuses to start without a password.
    env: str = "development"

    @property
    def production(self) -> bool:
        return self.env.lower() in ("production", "prod")

    # Shared-password sign-in (see auth.py). Empty password = auth off, for local development only.
    app_password: str = ""
    auth_secret: str = ""  # optional token-signing key; derived from the password when empty
    auth_access_minutes: int = 30  # bearer token sent with every request
    auth_refresh_days: int = 30  # exchanged for new tokens; rotated on each use (sliding)


@lru_cache
def get_settings() -> Settings:
    return Settings()
