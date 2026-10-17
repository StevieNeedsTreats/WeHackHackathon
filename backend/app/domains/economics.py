from .base import DomainPack, RubricItem, Slice

ECONOMICS = DomainPack(
    id="economics",
    name="Economics & policy",
    disclaimer=(
        "TruthGraph summarises published research. It is not policy, legal or financial advice. "
        "Results depend on place, period and design; grades reflect the papers found."
    ),
    subject_label="Policy or factor",
    outcome_label="Outcome",
    population_label="Population or setting",
    slices=[
        Slice("reviews", "Reviews & meta-analyses",
              "Literature reviews and meta-analyses that summarise many estimates.", ("openalex",)),
        Slice("causal", "Causal studies",
              "Natural experiments, difference-in-differences, regression discontinuity, field experiments and "
              "instrumental-variable studies that estimate the effect directly.", ("openalex",)),
        Slice("contrary", "Dissenting evidence",
              "Well-cited studies that reach the opposite conclusion to the hypothesis, and critiques or replications.",
              ("openalex",)),
    ],
    designs={
        "Meta-analysis": 30, "Field experiment": 26, "Natural experiment": 22, "Regression discontinuity": 22,
        "Difference-in-differences": 20, "Synthetic control": 18, "Instrumental variables": 18,
        "Panel / observational": 12, "Cross-sectional": 8, "Review": 10, "Theory or simulation": 5, "Other": 6,
    },
    judged=[
        RubricItem("identification", "Identification strength", 0, 8,
                   "How convincingly the design separates cause from correlation (parallel trends, valid instrument…)."),
        RubricItem("robustness", "Robustness checks", 0, 5, "Alternative specifications, placebo tests, sensitivity analyses."),
        RubricItem("data", "Data quality", 0, 5, "Administrative or large representative data vs small or self-reported samples."),
        RubricItem("external_validity", "External validity", 0, 4,
                   "How far the setting generalises to the population in the hypothesis."),
        RubricItem("conflicts", "Conflicts of interest", -8, 4,
                   "-8 = funded by an interested industry group or advocacy organisation; 4 = independent funding."),
    ],
    study_fields="identification strategy, sample (units and size), place, period, outcome measure, effect size and units",
    stance_notes="Small or statistically insignificant estimates count as refuting a hypothesis that predicts a meaningful effect.",
    verdict_notes="Mention when results differ by setting or period instead of averaging them away.",
    examples=["Does raising the minimum wage reduce employment?"],
)
