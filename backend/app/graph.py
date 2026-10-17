"""FalkorDB access layer.

Data model (property graph, one shared graph so papers/authors/funders are reused
across substances — that is the agents' shared memory):

  (:Substance)-[:STUDIED_IN]->(:Paper)-[:REPORTS]->(:Claim)-[:ABOUT]->(:Outcome)
  (:Paper)-[:AUTHORED_BY]->(:Author)        (:Paper)-[:FUNDED_BY]->(:Funder)
  (:Paper)-[:FROM_LAB]->(:Lab {region})     (:Paper)-[:CITES]->(:Paper)
  (:Claim)-[:CONTRADICTS {reason}]->(:Claim)
  (:Claim)-[:SUPPORTS]->(:Claim)            (:Task)-[:FOR]->(:Substance)

All writes are parameterised. Ad-hoc reads go through GRAPH.RO_QUERY with a timeout.
"""

from __future__ import annotations

import json
import time
from typing import Any

from falkordb.asyncio import FalkorDB
from falkordb.edge import Edge
from falkordb.node import Node
from falkordb.path import Path

from .config import get_settings

_INDEXES = [
    ("Substance", "key"),
    ("Paper", "id"),
    ("Claim", "id"),
    ("Claim", "substance"),
    ("Outcome", "key"),
    ("Author", "name"),
    ("Funder", "name"),
    ("Lab", "name"),
    ("Task", "substance"),
]


class GraphStore:
    def __init__(self) -> None:
        s = get_settings()
        self.db = FalkorDB(host=s.falkor_host, port=s.falkor_port)
        self.graph = self.db.select_graph(s.graph_name)
        self.settings = s

    async def init(self) -> None:
        for label, prop in _INDEXES:
            try:
                await self.graph.query(f"CREATE INDEX FOR (n:{label}) ON (n.{prop})")
            except Exception:
                pass  # already exists

    async def ping(self) -> bool:
        try:
            await self.graph.ro_query("RETURN 1")
            return True
        except Exception:
            return False

    async def q(self, query: str, params: dict | None = None):
        return await self.graph.query(query, params or {})

    async def ro(self, query: str, params: dict | None = None, timeout: int | None = None):
        return await self.graph.ro_query(query, params or {}, timeout=timeout or self.settings.query_timeout_ms)

    # ------------------------------------------------------------------ writes

    async def reset_substance(self, key: str) -> None:
        await self.q("MATCH (c:Claim {substance:$k}) DETACH DELETE c", {"k": key})
        await self.q("MATCH (t:Task {substance:$k}) DETACH DELETE t", {"k": key})
        await self.q("MATCH (s:Substance {key:$k})-[r:STUDIED_IN]->() DELETE r", {"k": key})

    async def upsert_substance(self, key: str, name: str) -> None:
        await self.q(
            "MERGE (s:Substance {key:$k}) SET s.name=$n, s.updated=timestamp()",
            {"k": key, "n": name},
        )

    async def upsert_paper(self, skey: str, p: dict) -> None:
        props = {k: v for k, v in p.items() if k not in {"authors", "funders"} and v is not None}
        props["funding"] = sorted({f["type"] for f in p.get("funders", [])}) or ["undisclosed"]
        props["first_authors"] = p.get("authors", [])[:3]
        await self.q(
            """
            MATCH (s:Substance {key:$sk})
            MERGE (p:Paper {id:$id}) SET p += $props
            MERGE (s)-[:STUDIED_IN]->(p)
            """,
            {"sk": skey, "id": p["id"], "props": props},
        )
        for i, name in enumerate(p.get("authors", [])[:3]):
            await self.q(
                "MATCH (p:Paper {id:$id}) MERGE (a:Author {name:$n}) MERGE (p)-[r:AUTHORED_BY]->(a) SET r.position=$i",
                {"id": p["id"], "n": name, "i": i},
            )
        if p.get("lab"):
            await self.q(
                "MATCH (p:Paper {id:$id}) MERGE (l:Lab {name:$n}) SET l.region=$r MERGE (p)-[:FROM_LAB]->(l)",
                {"id": p["id"], "n": p["lab"], "r": p.get("region") or ""},
            )
        for f in p.get("funders", []):
            await self.q(
                "MATCH (p:Paper {id:$id}) MERGE (f:Funder {name:$n}) SET f.type=$t MERGE (p)-[:FUNDED_BY]->(f)",
                {"id": p["id"], "n": f["name"], "t": f["type"]},
            )

    async def set_credibility(self, paper_id: str, score: int, reasons: list[dict], flags: list[str]) -> None:
        await self.q(
            "MATCH (p:Paper {id:$id}) SET p.credibility=$s, p.cred_reasons=$r, p.flags=$f",
            {"id": paper_id, "s": score, "r": json.dumps(reasons), "f": flags},
        )

    async def add_claim(self, skey: str, c: dict) -> None:
        await self.q(
            """
            MATCH (p:Paper {id:$pid})
            MERGE (o:Outcome {key:$okey}) SET o.name=$oname, o.category=$ocat
            MERGE (c:Claim {id:$id})
            SET c.text=$text, c.direction=$dir, c.effect=$effect, c.quote=$quote,
                c.quote_verified=$qv, c.harm=$harm, c.substance=$sk, c.paper_id=$pid, c.outcome=$okey,
                c.flags=$flags, c.extractor=$extractor
            MERGE (p)-[:REPORTS]->(c)
            MERGE (c)-[:ABOUT]->(o)
            """,
            {
                "pid": c["paper_id"], "okey": c["outcome_key"], "oname": c["outcome"], "ocat": c["category"],
                "id": c["id"], "text": c["text"], "dir": c["direction"], "effect": c.get("effect") or "",
                "quote": c.get("quote") or "", "qv": c["quote_verified"], "harm": bool(c.get("harm")), "sk": skey,
                "flags": c.get("flags", []), "extractor": c.get("extractor", "rules"),
            },
        )

    async def add_cites(self, src: str, dst: str) -> None:
        await self.q("MATCH (a:Paper {id:$a}), (b:Paper {id:$b}) MERGE (a)-[:CITES]->(b)", {"a": src, "b": dst})

    async def add_claim_edge(self, rel: str, a: str, b: str, props: dict) -> None:
        assert rel in {"CONTRADICTS", "SUPPORTS"}
        await self.q(
            f"MATCH (a:Claim {{id:$a}}), (b:Claim {{id:$b}}) MERGE (a)-[r:{rel}]->(b) SET r += $props",
            {"a": a, "b": b, "props": props},
        )

    async def log_task(self, skey: str, task: dict) -> None:
        await self.q(
            """
            MATCH (s:Substance {key:$sk})
            MERGE (t:Task {id:$id}) SET t += $props, t.substance=$sk
            MERGE (t)-[:FOR]->(s)
            """,
            {"sk": skey, "id": task["id"], "props": {k: v for k, v in task.items() if v is not None}},
        )

    # ------------------------------------------------------------------ reads

    async def substances(self) -> list[dict]:
        res = await self.ro(
            """
            MATCH (s:Substance)
            OPTIONAL MATCH (s)-[:STUDIED_IN]->(p:Paper)
            WITH s, count(p) AS papers
            WHERE papers > 0
            OPTIONAL MATCH (c:Claim {substance:s.key})
            RETURN s.key, s.name, papers, count(c) AS claims, s.updated
            ORDER BY s.updated DESC
            """
        )
        return [
            {"key": r[0], "name": r[1], "papers": r[2], "claims": r[3], "updated": r[4]}
            for r in res.result_set
        ]

    async def snapshot(self, key: str) -> dict:
        """Everything the canvas needs for one substance, in five read-only queries."""
        t0 = time.perf_counter()
        sub = await self.ro("MATCH (s:Substance {key:$k}) RETURN s", {"k": key})
        if not sub.result_set:
            return {"nodes": [], "edges": []}
        nodes: dict[str, dict] = {}
        edges: dict[str, dict] = {}

        def add_node(n: Node, kind: str, nid: str) -> None:
            props = _props(n)
            raw = props.pop("id", None)
            if kind in ("paper", "claim"):
                props[f"{kind}_id"] = raw
            nodes[nid] = {**props, "id": nid, "kind": kind}

        s = sub.result_set[0][0]
        add_node(s, "substance", f"s:{key}")

        papers = await self.ro(
            """
            MATCH (s:Substance {key:$k})-[:STUDIED_IN]->(p:Paper)
            OPTIONAL MATCH (p)-[ra:AUTHORED_BY]->(a:Author)
            OPTIONAL MATCH (p)-[:FUNDED_BY]->(f:Funder)
            OPTIONAL MATCH (p)-[:FROM_LAB]->(l:Lab)
            RETURN p, collect(DISTINCT [a, ra.position]), collect(DISTINCT f), l
            """,
            {"k": key},
        )
        paper_ids = set()
        for p, authors, funders, lab in papers.result_set:
            pid = p.properties["id"]
            paper_ids.add(pid)
            add_node(p, "paper", f"p:{pid}")
            edges[f"sp:{pid}"] = {"id": f"sp:{pid}", "source": f"s:{key}", "target": f"p:{pid}", "type": "STUDIED_IN"}
            if lab is not None:
                lid = f"l:{lab.properties['name']}"
                add_node(lab, "lab", lid)
                edges[f"pl:{pid}"] = {"id": f"pl:{pid}", "source": f"p:{pid}", "target": lid, "type": "FROM_LAB"}
            for a, pos in authors:
                if a is None:
                    continue
                aid = f"a:{a.properties['name']}"
                add_node(a, "author", aid)
                edges[f"pa:{pid}:{aid}"] = {"id": f"pa:{pid}:{aid}", "source": f"p:{pid}", "target": aid, "type": "AUTHORED_BY", "position": pos}
            for f in funders:
                if f is None:
                    continue
                fid = f"f:{f.properties['name']}"
                add_node(f, "funder", fid)
                edges[f"pf:{pid}:{fid}"] = {"id": f"pf:{pid}:{fid}", "source": f"p:{pid}", "target": fid, "type": "FUNDED_BY"}

        claims = await self.ro(
            "MATCH (p:Paper)-[:REPORTS]->(c:Claim {substance:$k})-[:ABOUT]->(o:Outcome) RETURN p.id, c, o",
            {"k": key},
        )
        for pid, c, o in claims.result_set:
            cid = f"c:{c.properties['id']}"
            add_node(c, "claim", cid)
            oid = f"o:{o.properties['key']}"
            add_node(o, "outcome", oid)
            edges[f"pc:{cid}"] = {"id": f"pc:{cid}", "source": f"p:{pid}", "target": cid, "type": "REPORTS"}
            edges[f"co:{cid}"] = {"id": f"co:{cid}", "source": cid, "target": oid, "type": "ABOUT"}

        rels = await self.ro(
            """
            MATCH (a:Claim {substance:$k})-[r:CONTRADICTS|SUPPORTS]->(b:Claim)
            RETURN a.id, b.id, type(r), r.reason, r.severity
            """,
            {"k": key},
        )
        for a, b, t, reason, sev in rels.result_set:
            eid = f"{t}:{a}:{b}"
            edges[eid] = {"id": eid, "source": f"c:{a}", "target": f"c:{b}", "type": t, "reason": reason, "severity": sev}

        cites = await self.ro(
            "MATCH (a:Paper)-[:CITES]->(b:Paper) WHERE a.id IN $ids AND b.id IN $ids RETURN a.id, b.id",
            {"ids": list(paper_ids)},
        )
        for a, b in cites.result_set:
            eid = f"cites:{a}:{b}"
            edges[eid] = {"id": eid, "source": f"p:{a}", "target": f"p:{b}", "type": "CITES"}

        return {
            "nodes": list(nodes.values()),
            "edges": list(edges.values()),
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        }

    async def counts(self) -> dict:
        res = await self.ro("MATCH (n) RETURN count(n)")
        rel = await self.ro("MATCH ()-[r]->() RETURN count(r)")
        return {"nodes": res.result_set[0][0], "edges": rel.result_set[0][0]}


def _props(n: Node) -> dict[str, Any]:
    out = dict(n.properties)
    if "cred_reasons" in out and isinstance(out["cred_reasons"], str):
        try:
            out["cred_reasons"] = json.loads(out["cred_reasons"])
        except ValueError:
            out["cred_reasons"] = []
    return out


def to_jsonable(v: Any) -> Any:
    """Convert FalkorDB result values for the read-only console."""
    if isinstance(v, Node):
        return {"_type": "node", "labels": list(v.labels or []), **_props(v)}
    if isinstance(v, Edge):
        return {"_type": "edge", "relation": v.relation, **(v.properties or {})}
    if isinstance(v, Path):
        return {"_type": "path", "nodes": [to_jsonable(n) for n in v.nodes()], "edges": [to_jsonable(e) for e in v.edges()]}
    if isinstance(v, list):
        return [to_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: to_jsonable(x) for k, x in v.items()}
    return v
