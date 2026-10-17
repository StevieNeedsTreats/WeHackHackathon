from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TG_", extra="ignore")

    falkor_host: str = "localhost"
    falkor_port: int = 6380
    graph_name: str = "truthgraph"

    # Extraction / summarisation run on the cheapest model (per the design board).
    anthropic_api_key: str | None = None
    extract_model: str = "claude-haiku-5-5"
    use_llm: bool = True

    max_papers: int = 12
    paper_concurrency: int = 6
    http_timeout_s: float = 12.0
    cache_ttl_s: int = 60 * 60 * 24

    rate_limit_per_min: int = 12
    max_concurrent_runs: int = 4
    query_timeout_ms: int = 3000
    query_row_limit: int = 500

    cors_origins: list[str] = ["http://localhost:3100", "http://127.0.0.1:3100"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
