"""Contradiction Mapper agent.

Compares claims about the same outcome across different papers and writes explicit
CONTRADICTS edges when directions or magnitudes conflict (reasons as on the board:
"opposite direction", "magnitude difference"). Agreeing claims get a SUPPORTS edge
to their strongest ally only, so the canvas stays readable.
"""

from __future__ import annotations

import re
from itertools import combinations

_NUM = re.compile(r"[−-]?\d+(?:\.\d+)?")


def _magnitude(effect: str | None) -> tuple[float, str] | None:
    if not effect:
        return None
    nums = [abs(float(x.replace("−", "-"))) for x in _NUM.findall(effect)]
    if not nums:
        return None
    unit = "%" if "%" in effect else ("kg" if "kg" in effect else re.sub(r"[\d\s.+−\-–±]", "", effect)[:6].lower())
    return sum(nums) / len(nums), unit


def map_relations(claims: list[dict], cred: dict[str, int]) -> tuple[list[dict], list[dict]]:
    by_outcome: dict[str, list[dict]] = {}
    for c in claims:
        by_outcome.setdefault(c["outcome_key"], []).append(c)

    contradictions, supports = [], []
    for group in by_outcome.values():
        for a, b in combinations(group, 2):
            if a["paper_id"] == b["paper_id"]:
                continue
            # Edge points from the more credible paper's claim.
            if cred.get(b["paper_id"], 0) > cred.get(a["paper_id"], 0):
                a, b = b, a
            lo = min(cred.get(a["paper_id"], 0), cred.get(b["paper_id"], 0))
            severity = "high" if lo >= 60 else "medium" if lo >= 45 else "low"
            dirs = {a["direction"], b["direction"]}
            if dirs == {"positive", "null"}:
                contradictions.append({"a": a["id"], "b": b["id"], "reason": "opposite direction", "severity": severity})
            elif a["direction"] == b["direction"] == "positive":
                ma, mb = _magnitude(a.get("effect")), _magnitude(b.get("effect"))
                if ma and mb and ma[1] == mb[1] and min(ma[0], mb[0]) > 0 and max(ma[0], mb[0]) / min(ma[0], mb[0]) >= 2.5:
                    contradictions.append({"a": a["id"], "b": b["id"], "reason": "magnitude difference", "severity": severity})

        # One SUPPORTS edge per claim, towards the most credible agreeing claim elsewhere.
        for c in group:
            if c["direction"] == "neutral":
                continue
            allies = [o for o in group if o["direction"] == c["direction"] and o["paper_id"] != c["paper_id"]]
            allies = [o for o in allies if cred.get(o["paper_id"], 0) > cred.get(c["paper_id"], 0)]
            if allies:
                best = max(allies, key=lambda o: cred.get(o["paper_id"], 0))
                supports.append({"a": c["id"], "b": best["id"]})
    return contradictions, supports
