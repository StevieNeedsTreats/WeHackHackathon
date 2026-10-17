"""Offline demo: the creatine example from the design board.

Abstracts are short illustrative summaries written for the demo (not the papers'
published abstracts), so every record is marked `demo: True` and the UI says so.
They run through the same extractor, credibility, grouper and contradiction agents
as live data.
"""

DEMO_SUBSTANCE = "Creatine"

DEMO_PAPERS = [
    {
        "id": "28615996", "pmid": "28615996", "label": "Kreider 2017", "year": 2017,
        "title": "Position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine",
        "journal": "J Int Soc Sports Nutr", "design": "Meta-analysis", "studies": 22, "sample_size": 680,
        "citations": 890, "peer_reviewed": True, "lab": "University of Texas A&M", "region": "United States",
        "authors": ["Kreider RB", "Kalman DS", "Antonio J"],
        "funders": [{"name": "National Institutes of Health", "type": "public"}],
        "abstract": (
            "Background: Creatine is one of the most widely used ergogenic aids. We pooled 22 studies of resistance-trained "
            "and untrained adults. Results: Creatine supplementation significantly improved upper- and lower-body strength by "
            "8–14% compared with placebo. Lean body mass increased by 1–2 kg over 4–12 weeks of training. "
            "Conclusions: Supplementation was well tolerated, with no adverse effects reported in studies lasting up to five years."
        ),
    },
    {
        "id": "12701815", "pmid": "12701815", "label": "Branch 2003", "year": 2003,
        "title": "Effect of creatine supplementation on body composition and performance: a meta-analysis",
        "journal": "Int J Sport Nutr Exerc Metab", "design": "Meta-analysis", "studies": 100, "sample_size": 1800,
        "citations": 1200, "peer_reviewed": True, "lab": "Old Dominion University", "region": "United States",
        "authors": ["Branch JD"],
        "funders": [{"name": "Old Dominion University", "type": "academic"}],
        "abstract": (
            "Background: The purpose of this meta-analysis was to quantify the effects of creatine on body composition and "
            "performance across 100 studies. Results: Creatine significantly increased maximal strength by 5–15% in short, "
            "repeated bouts. Effects on endurance performance were inconsistent and varied by person and task duration."
        ),
    },
    {
        "id": "demo-smith-2021", "label": "Smith 2021", "year": 2021,
        "title": "Creatine monohydrate and resistance training in recreationally active adults: a randomised trial",
        "journal": "Demo Journal of Exercise Science", "design": "RCT", "sample_size": 28,
        "citations": 45, "peer_reviewed": True, "lab": "University of Leeds", "region": "United Kingdom",
        "authors": ["Smith A", "Okafor B"],
        "funders": [{"name": "University of Leeds", "type": "academic"}],
        "abstract": (
            "Background: Few trials have tested creatine in recreationally active adults. Methods: 28 participants were "
            "randomised to creatine or placebo for 8 weeks. Results: There was no significant difference in strength between "
            "groups (no difference vs placebo). Creatine did not significantly increase lean mass compared with placebo."
        ),
    },
    {
        "id": "demo-lee-2019", "label": "Lee 2019", "year": 2019,
        "title": "A novel creatine blend increases lean mass in trained men",
        "journal": "Demo Supplement Research", "design": "RCT", "sample_size": 42,
        "citations": 18, "peer_reviewed": True, "lab": "Seoul National University", "region": "South Korea",
        "authors": ["Lee J", "Park S"],
        "funders": [{"name": "Company X Nutrition Inc", "type": "industry"}],
        "abstract": (
            "Background: Proprietary creatine blends are widely marketed. Methods: 42 trained men were randomised to the blend "
            "or placebo for 6 weeks. Results: The blend significantly increased lean mass by +2.5 kg relative to placebo. "
            "Strength improved by 30% in the blend group."
        ),
    },
    {
        "id": "14561278", "pmid": "14561278", "label": "Rae 2003", "year": 2003,
        "title": "Oral creatine monohydrate supplementation and brain performance",
        "journal": "Proc Biol Sci", "design": "RCT", "sample_size": 45,
        "citations": 310, "peer_reviewed": True, "lab": "University of Sydney", "region": "Australia",
        "authors": ["Rae C", "Digney AL", "McEwan SR"],
        "funders": [{"name": "National Health and Medical Research Council", "type": "public"}],
        "abstract": (
            "Background: The brain relies on creatine for energy buffering. Methods: 45 young adult vegetarians took creatine "
            "or placebo for 6 weeks in a crossover design. Results: Working memory and intelligence scores improved only in "
            "vegetarians, whose baseline creatine intake is low."
        ),
    },
    {
        "id": "demo-moriarty-2023", "label": "Moriarty 2023", "year": 2023,
        "title": "Creatine and cognition in healthy older adults: a randomised controlled trial",
        "journal": "Demo Journal of Ageing", "design": "RCT", "sample_size": 36,
        "citations": 12, "peer_reviewed": True, "lab": "University College Dublin", "region": "Ireland",
        "authors": ["Moriarty T", "Byrne K"],
        "funders": [{"name": "Health Research Board Ireland", "type": "public"}],
        "abstract": (
            "Background: Interest in creatine for brain ageing is growing. Methods: 36 older adults received creatine or "
            "placebo for 12 weeks. Results: Creatine did not improve memory or executive function compared with placebo. "
            "No adverse events were reported."
        ),
    },
    {
        "id": "demo-souza-2019", "label": "de Souza 2019", "year": 2019,
        "title": "Creatine supplementation and kidney function: a systematic review and meta-analysis",
        "journal": "Demo Renal Reviews", "design": "Meta-analysis", "studies": 15, "sample_size": 520,
        "citations": 140, "peer_reviewed": True, "lab": "University of São Paulo", "region": "Brazil",
        "authors": ["de Souza E Silva A", "Pertille A"],
        "funders": [],
        "abstract": (
            "Background: Renal safety concerns limit creatine use. We pooled 15 controlled trials. Results: Creatine did not "
            "significantly change creatinine clearance or other markers of kidney function. Conclusions: Short- and long-term "
            "supplementation did not cause renal damage in healthy adults."
        ),
    },
]

DEMO_CITES = [
    ("28615996", "12701815"),
    ("demo-lee-2019", "28615996"),
    ("demo-lee-2019", "12701815"),
    ("demo-smith-2021", "12701815"),
    ("demo-moriarty-2023", "14561278"),
    ("demo-souza-2019", "28615996"),
]


def demo_papers() -> list[dict]:
    out = []
    for p in DEMO_PAPERS:
        q = dict(p)
        q.setdefault("pmid", None)
        q.setdefault("studies", None)
        q.update({
            "demo": True,
            "open_access": False,
            "retracted": False,
            "animal": False,
            "pub_types": [q["design"]],
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{q['pmid']}/" if q.get("pmid") else "",
        })
        out.append(q)
    return out
