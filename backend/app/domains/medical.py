from .base import DomainPack, RubricItem, Slice

MEDICAL = DomainPack(
    id="medical",
    name="Medicine & health",
    disclaimer=(
        "TruthGraph summarises published research. It is not medical advice and does not replace a clinician. "
        "Evidence grades reflect the papers found, not certainty about you."
    ),
    subject_label="Intervention",
    outcome_label="Outcome",
    population_label="Population",
    slices=[
        Slice("reviews", "Reviews & meta-analyses",
              "Systematic reviews and meta-analyses that pool many studies on this question.",
              ("europepmc",)),
        Slice("trials", "Randomised trials",
              "Randomised controlled trials and other controlled clinical trials that test the outcome directly.",
              ("europepmc",)),
        Slice("safety", "Safety & harms",
              "Adverse events, side effects, toxicity, pharmacovigilance, case series and case reports.",
              ("europepmc",)),
        Slice("registry", "Trial registry",
              "Registered clinical trials, including unpublished or ongoing ones, to show what is still being tested.",
              ("clinicaltrials",)),
    ],
    designs={
        "Meta-analysis": 30, "Systematic review": 27, "RCT": 24, "Clinical trial": 17, "Cohort": 13,
        "Case-control": 11, "Cross-sectional": 8, "Review": 8, "Case series": 5, "Case report": 3,
        "Registered trial": 4, "Animal or lab study": 2, "Other": 6,
    },
    judged=[
        RubricItem("randomisation", "Randomisation & blinding", 0, 8,
                   "8 = properly randomised and double-blind; 4 = randomised, open label; 0 = neither or not stated."),
        RubricItem("attrition", "Attrition & reporting", 0, 4,
                   "Dropouts reported and handled (e.g. intention-to-treat), outcomes pre-registered."),
        RubricItem("population", "Population relevance", 0, 6,
                   "How well the studied people match the hypothesis population (humans, age, sex, condition, pregnancy)."),
        RubricItem("effect_reporting", "Effect reporting", 0, 4,
                   "Effect sizes with confidence intervals rather than only p-values or narrative claims."),
        RubricItem("conflicts", "Conflicts of interest", -8, 4,
                   "-8 = funded or authored by the manufacturer/seller; 0 = not stated; 4 = independent funding declared."),
    ],
    study_fields="design, number of participants, population (age, sex, condition, pregnancy), dose or exposure, duration, comparator, blinding",
    extractor_notes="Animal and in-vitro work must be labelled 'Animal or lab study'. Case reports describe single patients.",
    stance_notes=(
        "For harm hypotheses (\"X causes adverse outcome Y\"), a finding of no adverse events REFUTES the hypothesis "
        "and a reported harm SUPPORTS it."
    ),
    verdict_notes="Never give dosing or treatment advice. Say plainly when evidence in the asked population is missing.",
    examples=[
        "effects of minoxidil on hair loss, and side effects of minoxidil in pregnant women",
        "what happens if a pregnant woman takes minoxidil?",
        "creatine and intelligence vs creatine and muscle gain",
    ],
)
