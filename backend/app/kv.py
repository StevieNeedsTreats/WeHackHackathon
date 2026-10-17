"""Key-value storage on top of a FalkorDB graph.

FalkorDB Cloud users may only run graph commands, not plain Redis ones (GET, SET, XADD are
refused). The app's side storage (abstracts, verdicts, run records, LLM and HTTP caches, run
logs) therefore lives in its own small graph next to the evidence graph, behind the same few
calls the app used on Redis: get, set (with expiry), pipelined sets, delete and xadd.

Values come back as bytes, as they do from redis-py, so callers don't change.
"""

from __future__ import annotations

import json
import time
from typing import Any

from falkordb.asyncio import FalkorDB


class GraphKV:
    def __init__(self, conn: dict, graph: str):
        self.db = FalkorDB(**conn)
        self.graph = self.db.select_graph(graph)

    async def init(self) -> None:
        for q in ("CREATE INDEX FOR (e:KV) ON (e.k)", "CREATE INDEX FOR (l:Log) ON (l.k)"):
            try:
                await self.graph.query(q)
            except Exception:
                pass  # already exists

    async def get(self, key: str) -> bytes | None:
        res = await self.graph.ro_query("MATCH (e:KV {k:$k}) WHERE e.exp IS NULL OR e.exp > $now RETURN e.v",
                                        {"k": key, "now": time.time()})
        return res.result_set[0][0].encode() if res.result_set else None

    async def set(self, key: str, value: str | bytes, ex: int | None = None) -> None:
        await self._set_many([(key, value, ex)])

    async def _set_many(self, items: list[tuple[str, Any, int | None]]) -> None:
        now = time.time()
        rows = [{"k": k, "v": v.decode() if isinstance(v, bytes) else str(v), "exp": now + ex if ex else None}
                for k, v, ex in items]
        for i in range(0, len(rows), 200):
            await self.graph.query("UNWIND $rows AS r MERGE (e:KV {k:r.k}) SET e.v = r.v, e.exp = r.exp",
                                   {"rows": rows[i:i + 200]})

    async def delete(self, *keys: str) -> None:
        await self.graph.query("UNWIND $ks AS k MATCH (e:KV {k:k}) DELETE e", {"ks": list(keys)})
        await self.graph.query("UNWIND $ks AS k MATCH (l:Log {k:k}) DELETE l", {"ks": list(keys)})

    async def xadd(self, name: str, fields: dict, maxlen: int | None = None, **_: Any) -> None:
        """Append one entry to a log (Redis stream stand-in), keeping the newest `maxlen`."""
        await self.graph.query(
            "MERGE (l:Log {k:$k}) SET l.entries = coalesce(l.entries, []) + [$e] "
            "WITH l WHERE $max IS NOT NULL AND size(l.entries) > $max SET l.entries = l.entries[-$max..]",
            {"k": name, "e": json.dumps({"t": time.time(), **fields}), "max": maxlen},
        )

    async def purge_expired(self) -> int:
        res = await self.graph.query("MATCH (e:KV) WHERE e.exp IS NOT NULL AND e.exp <= $now DELETE e RETURN count(e)",
                                     {"now": time.time()})
        return res.result_set[0][0] if res.result_set else 0

    def pipeline(self) -> "_Pipeline":
        return _Pipeline(self)

    async def aclose(self) -> None:
        try:
            await self.db.connection.aclose()
        except Exception:
            pass


class _Pipeline:
    """Collects sets and writes them in one batched query."""

    def __init__(self, kv: GraphKV):
        self.kv, self.items = kv, []

    def set(self, key: str, value: str | bytes, ex: int | None = None) -> "_Pipeline":
        self.items.append((key, value, ex))
        return self

    async def execute(self) -> None:
        if self.items:
            await self.kv._set_many(self.items)
        self.items = []
