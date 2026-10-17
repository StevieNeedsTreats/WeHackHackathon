import { Building2, Check, Coins, ExternalLink, FileText, Flag, TriangleAlert, User } from "lucide-react";
import type { Direction } from "@/lib/types";

export const DIR = {
  positive: { label: "Positive", glyph: "+", color: "var(--pos)", soft: "var(--pos-soft)", ink: "var(--pos-ink)" },
  neutral: { label: "Mixed", glyph: "~", color: "var(--neu)", soft: "var(--neu-soft)", ink: "var(--neu-ink)" },
  null: { label: "Negative / null", glyph: "−", color: "var(--neg)", soft: "var(--neg-soft)", ink: "var(--neg-ink)" },
} as const;

export function DirGlyph({ dir, size = 18 }: { dir: Direction; size?: number }) {
  const d = DIR[dir];
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
  Observational: "OBS",
  Review: "REVIEW",
  "Case report": "CASE",
  Other: "OTHER",
};
