"""Domain packs: what changes when the claim is about medicine, economics or anything else.

A pack decides where agents search, what a "study" records, how credibility is scored
and which disclaimer is shown. The agents and the graph are the same for every pack.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class Slice:
    """One discovery agent's beat, e.g. "randomised trials" or "safety reports"."""

    id: str
    label: str
    guidance: str
    sources: tuple[str, ...]


@dataclass(frozen=True)
class RubricItem:
    """A credibility item the LLM judges; code clamps it to [min, max] and adds it up."""

    id: str
    label: str
    min: int
    max: int
    guidance: str


@dataclass
class DomainPack:
    id: str
    name: str
    disclaimer: str
    subject_label: str
    outcome_label: str
    population_label: str
    slices: list[Slice]
    designs: dict[str, int]
    judged: list[RubricItem]
    study_fields: str
    extractor_notes: str = ""
    stance_notes: str = ""
    verdict_notes: str = ""
    examples: list[str] = field(default_factory=list)

    @property
    def sources(self) -> list[str]:
        return sorted({s for sl in self.slices for s in sl.sources})

    def design_names(self) -> list[str]:
        return list(self.designs)

    def computed(self, paper: dict, design: str | None, n: int | None, pooled: int | None) -> list[dict]:
        """Metadata-only credibility items. Never looks at whether the result is positive."""
        reasons: list[dict] = []

        def add(label: str, pts: float, detail: str) -> None:
            reasons.append({"id": label.lower().replace(" ", "-"), "label": label, "points": round(pts), "detail": detail})

        design = design if design in self.designs else "Other"
        add("Study design", self.designs.get(design, 6), design)
        if pooled:
            add("Evidence base", min(15, 4 + 2.6 * math.log2(pooled)), f"{pooled} pooled studies")
        elif n:
            add("Sample size", max(0, min(15, 2.5 * math.log2(max(n, 2)) - 5)), f"n = {n:,}")
        else:
            add("Sample size", 2, "not reported")
        cites = paper.get("citations") or 0
        add("Citations", min(12, 2.0 * math.log2(cites + 1)), f"{cites:,} citing works")
        if paper.get("kind") == "registry":
            add("Peer review", 0, "trial registry record, not a publication")
        elif paper.get("peer_reviewed", True):
            add("Peer review", 8, "peer-reviewed venue")
        else:
            add("Peer review", 0, "preprint or working paper")
        year = paper.get("year")
        if year:
            add("Recency", max(0, 5 - (date.today().year - year) / 5), f"published {year}")
        return reasons


def total_score(reasons: list[dict], retracted: bool) -> int:
    if retracted:
        return 0
    return int(max(0, min(100, round(sum(r["points"] for r in reasons)))))
