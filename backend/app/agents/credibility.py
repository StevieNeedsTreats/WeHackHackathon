"""Credibility Enricher agent: an objective 0-100 score with itemised reasons.

Scored only from metadata (design, sample, citations, peer review, funding, recency),
never from whether the result is positive — so the score can't launder a conclusion.
"""

from __future__ import annotations

import math
from datetime import date

DESIGN_POINTS = {
    "Meta-analysis": 38,
    "Systematic review": 34,
    "RCT": 30,
    "Clinical trial": 22,
    "Observational": 16,
    "Review": 14,
    "Case report": 5,
    "Other": 10,
}


def score(p: dict) -> tuple[int, list[dict], list[str]]:
    reasons: list[dict] = []
    flags: list[str] = []

    def add(label: str, pts: float, detail: str) -> None:
        reasons.append({"label": label, "points": round(pts), "detail": detail})

    design = p.get("design", "Other")
    add("Study design", DESIGN_POINTS.get(design, 10), design)

    n, studies = p.get("sample_size"), p.get("studies")
    if studies:
        add("Evidence base", min(20, 6 + 3.2 * math.log2(studies)), f"{studies} pooled studies")
    elif n:
        add("Sample size", min(20, 3.0 * math.log2(max(n, 2)) - 6), f"n = {n}")
        if n < 30:
            flags.append("small-sample")
    else:
        add("Sample size", 4, "not reported in abstract")
        flags.append("sample-unreported")

    cites = p.get("citations") or 0
    add("Citations", min(15, 2.4 * math.log2(cites + 1)), f"{cites:,} citing works")

    if p.get("peer_reviewed", True):
        add("Peer review", 10, "indexed, peer-reviewed journal")
    else:
        add("Peer review", 0, "preprint")
        flags.append("preprint")

    funders = p.get("funders") or []
    types = {f["type"] for f in funders}
    if "industry" in types:
        add("Funding", -8, "industry funding disclosed")
        flags.append("industry-funded")
    elif types & {"public", "academic"}:
        add("Funding", 6, "public / academic funding")
    else:
        add("Funding", 0, "no funding disclosed")
        flags.append("funding-undisclosed")

    year = p.get("year")
    if year:
        age = date.today().year - year
        add("Recency", max(0, 6 - age / 4), f"published {year}")

    if p.get("animal"):
        add("Population", -15, "animal study")
        flags.append("animal-study")
    if p.get("retracted"):
        flags.append("retracted")
        return 0, reasons + [{"label": "Retraction", "points": -100, "detail": "publication retracted"}], flags

    total = int(max(0, min(100, round(sum(r["points"] for r in reasons)))))
    if total < 45:
        flags.append("low-credibility")
    return total, reasons, flags
