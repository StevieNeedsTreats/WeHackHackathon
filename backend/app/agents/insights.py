"""Insights agent: turns the evidence graph into graded, explainable findings.

Everything here is computed from graph data (credibility-weighted), so each insight
points back to the claims it rests on. The optional Claude narrative is written
strictly from these computed facts.
"""

from __future__ import annotations

from collections import defaultdict

DESIGN_RANK = {"Meta-analysis": 5, "Systematic review": 4, "RCT": 3, "Clinical trial": 2, "Observational": 1}


def _weight(c: dict, cred: dict[str, int]) -> float:
    w = cred.get(c["paper_id"], 0) / 100
    if not c.get("quote_verified", True):
        w *= 0.5
    return w


def outcome_consensus(claims: list[dict], papers: dict[str, dict], cred: dict[str, int]) -> list[dict]:
    by_outcome: dict[str, list[dict]] = defaultdict(list)
    for c in claims:
        by_outcome[c["outcome_key"]].append(c)

    rows = []
    for key, group in by_outcome.items():
        w = {"positive": 0.0, "neutral": 0.0, "null": 0.0}
        for c in group:
            w[c["direction"]] += _weight(c, cred)
        total = sum(w.values()) or 1e-9
        share = {k: v / total for k, v in w.items()}
        paper_ids = {c["paper_id"] for c in group}
        best_design = max((DESIGN_RANK.get(papers[p]["design"], 0) for p in paper_ids if p in papers), default=0)
        safety = group[0]["category"] == "safety"

        if safety:
            # Directions are benefit-oriented, so "positive" on a safety outcome means no harm found.
            if share["positive"] >= 0.7:
                verdict, tone = "No safety signal", "positive"
            elif share["null"] >= 0.5:
                verdict, tone = "Safety signal reported", "null"
            else:
                verdict, tone = "Mixed safety picture", "neutral"
        elif share["positive"] >= 0.7:
            verdict, tone = ("Consistent support" if len(paper_ids) >= 2 else "Single-study support"), "positive"
        elif share["positive"] >= 0.4:
            verdict, tone = "Mixed evidence", "neutral"
        elif any(c.get("harm") for c in group):
            verdict, tone = "Possible harm", "null"
        else:
            verdict, tone = "Little or no effect", "null"

        dominant = max(share.values())
        if best_design >= 4 and len(paper_ids) >= 2 and dominant >= 0.7:
            grade = "A"
        elif best_design >= 3 and len(paper_ids) >= 2 and dominant >= 0.6:
            grade = "B"
        elif best_design >= 2 or len(paper_ids) >= 2:
            grade = "C"
        else:
            grade = "D"

        rows.append({
            "outcome_key": key,
            "outcome": group[0]["outcome"],
            "category": group[0]["category"],
            "papers": len(paper_ids),
            "claims": len(group),
            "share": {k: round(v, 3) for k, v in share.items()},
            "weight": round(total, 2),
            "verdict": verdict,
            "tone": tone,
            "grade": grade,
            "claim_ids": [c["id"] for c in group],
        })
    rows.sort(key=lambda r: (-r["weight"], r["outcome"]))
    return rows


def _plural(n: int, word: str, many: str | None = None) -> str:
    return f"{n} {word if n == 1 else (many or word + 's')}"


def build_insights(papers: dict[str, dict], claims: list[dict], cred: dict[str, int],
                   contradictions: list[dict]) -> dict:
    consensus = outcome_consensus(claims, papers, cred)
    items: list[dict] = []
    claim_by_id = {c["id"]: c for c in claims}

    efficacy = [r for r in consensus if r["category"] != "safety"]
    if efficacy:
        top = max(efficacy, key=lambda r: ("DCBA".index(r["grade"]), r["share"]["positive"] * r["weight"]))
        items.append({
            "kind": "headline",
            "title": f"Strongest evidence: {top['outcome'].lower()}",
            "body": f"{top['verdict']} across {_plural(top['papers'], 'paper')} "
                    f"({round(top['share']['positive'] * 100)}% of credibility-weighted evidence positive). Grade {top['grade']}.",
            "tone": top["tone"], "refs": top["claim_ids"],
        })
        weak = [r for r in efficacy if r["tone"] == "null"]
        if weak:
            w = weak[0]
            items.append({
                "kind": "finding", "title": f"Weak case for {w['outcome'].lower()}",
                "body": f"Most weighted evidence finds no effect on {w['outcome'].lower()} ({round(w['share']['null'] * 100)}% null).",
                "tone": "null", "refs": w["claim_ids"],
            })
        mixed = [r for r in efficacy if r["tone"] == "neutral" and r["papers"] >= 2]
        if mixed:
            m = mixed[0]
            items.append({
                "kind": "finding", "title": f"Unsettled: {m['outcome'].lower()}",
                "body": f"{_plural(m['papers'], 'paper')} disagree — {round(m['share']['positive'] * 100)}% positive, "
                        f"{round(m['share']['null'] * 100)}% null, {round(m['share']['neutral'] * 100)}% mixed by weight.",
                "tone": "neutral", "refs": m["claim_ids"],
            })

    for r in [r for r in consensus if r["category"] == "safety"][:2]:
        items.append({
            "kind": "safety", "title": f"{r['verdict']} · {r['outcome'].lower()}",
            "body": f"{_plural(r['claims'], 'claim')} from {_plural(r['papers'], 'paper')} address {r['outcome'].lower()}.",
            "tone": r["tone"], "refs": r["claim_ids"],
        })

    if contradictions:
        c = sorted(contradictions, key=lambda x: {"high": 0, "medium": 1, "low": 2}[x["severity"]])[0]
        a, b = claim_by_id.get(c["a"]), claim_by_id.get(c["b"])
        if a and b:
            pa, pb = papers.get(a["paper_id"], {}), papers.get(b["paper_id"], {})
            items.append({
                "kind": "conflict",
                "title": f"{_plural(len(contradictions), 'contradiction')} to resolve",
                "body": f"{pa.get('label')} (credibility {cred.get(a['paper_id'])}) reports “{a['text']}” while "
                        f"{pb.get('label')} (credibility {cred.get(b['paper_id'])}) reports “{b['text']}” — {c['reason']}.",
                "tone": "null", "refs": [a["id"], b["id"]],
            })

    # Funding: do industry-funded papers report positive results more often?
    def pos_rate(pids: set[str]) -> tuple[float, int]:
        cs = [c for c in claims if c["paper_id"] in pids and c["category"] != "safety"]
        return (sum(c["direction"] == "positive" for c in cs) / len(cs) if cs else 0.0), len(cs)

    ftype = {pid: {f["type"] for f in p.get("funders", [])} for pid, p in papers.items()}
    industry = {pid for pid, t in ftype.items() if "industry" in t}
    independent = {pid for pid, t in ftype.items() if t and "industry" not in t}
    undisclosed = {pid for pid, t in ftype.items() if not t}
    ri, ni = pos_rate(industry)
    rn, nn = pos_rate(independent)
    if ni >= 2 and nn >= 2:
        gap = ri - rn
        items.append({
            "kind": "funding",
            "title": "No clear funding skew" if abs(gap) < 0.25 else ("Industry-funded papers lean positive" if gap > 0 else "Independent papers lean positive"),
            "body": f"{round(ri * 100)}% of industry-funded claims are positive vs {round(rn * 100)}% with public or academic funding "
                    f"({len(industry)} vs {len(independent)} papers).",
            "tone": "neutral" if abs(gap) < 0.25 else "null",
            "refs": [c["id"] for c in claims if c["paper_id"] in industry],
        })
    elif industry:
        items.append({
            "kind": "funding", "title": f"{_plural(len(industry), 'industry-funded paper')}",
            "body": "Too few papers on each side to test for funding bias; read these with their funding in mind.",
            "tone": "neutral", "refs": [c["id"] for c in claims if c["paper_id"] in industry],
        })
    if undisclosed and len(undisclosed) >= max(2, len(papers) // 2):
        items.append({
            "kind": "funding", "title": f"{len(undisclosed)} of {len(papers)} papers list no funder",
            "body": "No grant is recorded for these papers. Funding may exist but isn't machine-readable, so treat funding analysis as partial.",
            "tone": "neutral", "refs": [],
        })

    gaps = [r for r in efficacy if r["papers"] == 1]
    if gaps:
        items.append({
            "kind": "gap", "title": "Evidence gaps",
            "body": "Only one paper speaks to " + ", ".join(r["outcome"].lower() for r in gaps[:4]) + ". Treat these as preliminary.",
            "tone": "neutral", "refs": [cid for r in gaps for cid in r["claim_ids"]],
        })

    small = [p for p in papers.values() if p.get("sample_size") and p["sample_size"] < 30 and not p.get("studies")]
    if small:
        items.append({
            "kind": "quality", "title": f"{_plural(len(small), 'small-sample study', 'small-sample studies')}",
            "body": "Fewer than 30 participants: " + ", ".join(p["label"] for p in small[:4]) + ". Their claims carry less weight.",
            "tone": "neutral", "refs": [],
        })

    return {"consensus": consensus, "items": items}


NARRATIVE_SYSTEM = (
    "You write a 3-sentence plain-English evidence summary for a general reader. Use ONLY the facts provided. "
    "Do not give dosing or medical advice. Mention the evidence grade and any contradictions. No preamble, no lists."
)
