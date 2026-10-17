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
      className="mono inline-flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{ width: size, height: size, fontSize: size * 0.68, color: "#fff", background: d.color, lineHeight: 1 }}
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
  "Meta-analysis": "META",
  "Systematic review": "SYS REV",
  RCT: "RCT",
  "Clinical trial": "TRIAL",
  "Registered trial": "REGISTRY",
  Cohort: "COHORT",
  "Case-control": "CASE-CTRL",
  "Cross-sectional": "X-SECT",
  "Case series": "SERIES",
  "Case report": "CASE",
  "Animal or lab study": "ANIMAL",
  "Field experiment": "FIELD EXP",
  "Natural experiment": "NAT EXP",
  "Regression discontinuity": "RDD",
  "Difference-in-differences": "DID",
  "Synthetic control": "SYNTH",
  "Instrumental variables": "IV",
  "Panel / observational": "PANEL",
  "Controlled experiment": "EXPERIMENT",
  "Quasi-experiment": "QUASI",
  Observational: "OBS",
  Review: "REVIEW",
  "Theory or simulation": "THEORY",
  "Case study": "CASE",
  "Opinion or commentary": "OPINION",
  Other: "OTHER",
};

export const designShort = (d?: string | null) => (d ? DESIGN_SHORT[d] ?? d.slice(0, 10).toUpperCase() : "…");
