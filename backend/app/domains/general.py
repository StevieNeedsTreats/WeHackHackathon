from .base import DomainPack, RubricItem, Slice

GENERAL = DomainPack(
    id="general",
    name="General research",
    disclaimer=(
        "Nodes Don't Lie summarises published research. It is not professional advice. "
        "Grades reflect the papers found, not the final word on the question."
    ),
    subject_label="Subject",
    outcome_label="Outcome",
    population_label="Context",
    slices=[
        Slice("reviews", "Reviews & meta-analyses", "Reviews and meta-analyses that summarise the question.", ("openalex",)),
        Slice("primary", "Primary studies", "Experiments and empirical studies that test the claim directly.", ("openalex",)),
        Slice("contrary", "Dissenting evidence", "Studies and critiques that argue against the claim.", ("openalex",)),
    ],
    designs={
        "Meta-analysis": 30, "Systematic review": 27, "Controlled experiment": 24, "Quasi-experiment": 18,
        "Observational": 12, "Review": 10, "Case study": 6, "Opinion or commentary": 3, "Other": 6,
    },
    judged=[
        RubricItem("rigor", "Methodological rigour", 0, 12, "Controls, sample size, measurement and analysis appropriate to the claim."),
        RubricItem("transparency", "Transparency", 0, 8, "Data, methods and limitations reported clearly."),
        RubricItem("conflicts", "Conflicts of interest", -8, 4, "-8 = funded by a party with a stake in the answer; 4 = independent."),
    ],
    study_fields="design, sample, setting, measures, effect size",
)
