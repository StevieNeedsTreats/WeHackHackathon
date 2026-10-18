import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, Building2, Check, Coins, ExternalLink, FileText, Flag, TriangleAlert, User } from "lucide-react";
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

// Drawn marks for each stance on a 16-unit grid: plus, a wave, minus.
const MARK: Record<Stance, string> = {
  supports: "M8 4.75v6.5M4.75 8h6.5",
  mixed: "M4.5 8.6c1.1-1.5 2.2-1.5 3.5 0s2.4 1.5 3.5 0",
  refutes: "M4.75 8h6.5",
};

export function StanceGlyph({ stance, size = 18 }: { stance: Stance; size?: number }) {
  const d = STANCE[stance];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" role="img" aria-label={d.label}>
      <circle cx="8" cy="8" r="8" fill={d.color} />
      <path d={MARK[stance]} stroke="var(--card)" strokeWidth="1.9" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const ARROWS = { increase: ArrowUp, decrease: ArrowDown, no_change: ArrowRight, mixed: ArrowUpDown } as const;

export function DirectionIcon({ direction, size = 12, className = "" }: { direction: Direction; size?: number; className?: string }) {
  const C = ARROWS[direction] ?? ArrowRight;
  return <C size={size} strokeWidth={2} className={`shrink-0 ${className}`} aria-label={DIRECTION[direction]?.label} />;
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
