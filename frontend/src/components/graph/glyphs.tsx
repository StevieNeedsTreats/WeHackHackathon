import { Building2, Check, Coins, ExternalLink, FileText, Flag, TriangleAlert, User } from "lucide-react";
import type { Direction, Stance } from "@/lib/types";

export const STANCE = {
  supports: { label: "Supports", glyph: "+", color: "var(--pos)", soft: "var(--pos-soft)", ink: "var(--pos-ink)" },
  mixed: { label: "Mixed", glyph: "~", color: "var(--neu)", soft: "var(--neu-soft)", ink: "var(--neu-ink)" },
  refutes: { label: "Refutes", glyph: "−", color: "var(--neg)", soft: "var(--neg-soft)", ink: "var(--neg-ink)" },
} as const;

export const TONE = {
  support: STANCE.supports,
  mixed: STANCE.mixed,
  refute: STANCE.refutes,
  neutral: { label: "Neutral", glyph: "·", color: "var(--ink-3)", soft: "var(--surface-3)", ink: "var(--ink-2)" },
} as const;

export const DIRECTION: Record<Direction, { arrow: string; label: string }> = {
  increase: { arrow: "↑", label: "increased" },
  decrease: { arrow: "↓", label: "decreased" },
  no_change: { arrow: "→", label: "no change" },
  mixed: { arrow: "↕", label: "mixed" },
};

export function StanceGlyph({ stance, size = 18 }: { stance: Stance; size?: number }) {
  const d = STANCE[stance];
  return (
    <span
      aria-label={d.label}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{ width: size, height: size, fontSize: size * 0.68, color: "var(--card)", background: d.color, lineHeight: 1 }}
    >
      {d.glyph}
    </span>
  );
}

const ICONS = {
  person: User,
  lab: Building2,
  coin: Coins,
  flag: Flag,
  check: Check,
  alert: TriangleAlert,
  link: ExternalLink,
  doc: FileText,
} as const;

export function Icon({ name, size = 12, className = "" }: { name: keyof typeof ICONS; size?: number; className?: string }) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={1.75} className={className} aria-hidden />;
}

export const DESIGN_SHORT: Record<string, string> = {
  "Meta-analysis": "Meta",
  "Systematic review": "Review",
  RCT: "RCT",
  "Clinical trial": "Trial",
  "Registered trial": "Registry",
  Cohort: "Cohort",
  "Case-control": "Case-control",
  "Cross-sectional": "Cross-sect.",
  "Case series": "Case series",
  "Case report": "Case report",
  "Animal or lab study": "Lab study",
  "Field experiment": "Field exp.",
  "Natural experiment": "Natural exp.",
  "Regression discontinuity": "RDD",
  "Difference-in-differences": "Diff-in-diff",
  "Synthetic control": "Synth. control",
  "Instrumental variables": "IV",
  "Panel / observational": "Panel",
  "Controlled experiment": "Experiment",
  "Quasi-experiment": "Quasi-exp.",
  Observational: "Obs.",
  Review: "Review",
  "Theory or simulation": "Theory",
  "Case study": "Case study",
  "Opinion or commentary": "Opinion",
  Other: "Other",
};

export const designShort = (d?: string | null) => (d ? DESIGN_SHORT[d] ?? d.slice(0, 14) : "…");
