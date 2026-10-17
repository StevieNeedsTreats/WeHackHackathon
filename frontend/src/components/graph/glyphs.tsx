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

export function Icon({ name, size = 12, className = "" }: { name: "person" | "lab" | "coin" | "flag" | "check" | "alert" | "link" | "doc"; size?: number; className?: string }) {
  const p = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className };
  switch (name) {
    case "person":
      return (
        <svg {...p}>
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" />
        </svg>
      );
    case "lab":
      return (
        <svg {...p}>
          <path d="M2.5 13.5h11M3.5 13.5V6.5L8 3.5l4.5 3v7M6.5 13.5v-3h3v3" />
        </svg>
      );
    case "coin":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v6M6.3 6.6c0-.8.8-1.3 1.7-1.3s1.7.4 1.7 1.2c0 1.7-3.4.9-3.4 2.7 0 .8.8 1.3 1.7 1.3s1.7-.5 1.7-1.3" />
        </svg>
      );
    case "flag":
      return (
        <svg {...p}>
          <path d="M3.5 14V2.5M3.5 3h8l-1.6 2.6L11.5 8h-8" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      );
    case "alert":
      return (
        <svg {...p}>
          <path d="M8 2.5l6 11H2l6-11zM8 6.5v3M8 11.5v.01" />
        </svg>
      );
    case "link":
      return (
        <svg {...p}>
          <path d="M9.5 3.5h3v3M12.5 3.5L7 9M11 9.5v3h-7.5V5H7" />
        </svg>
      );
    case "doc":
      return (
        <svg {...p}>
          <path d="M4 1.5h5.5l3 3v10H4zM9.5 1.5v3h3M6 8h5M6 10.5h5" />
        </svg>
      );
  }
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
