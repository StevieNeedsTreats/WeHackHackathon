"use client";

import { useMemo } from "react";
import type { State } from "@/lib/store";
import { STANCE, TONE } from "./graph/glyphs";

// How uncertain each grade is, as the diamond's half-width on a -1..1 axis.
const SPREAD: Record<string, number> = { A: 0.1, B: 0.17, C: 0.27, D: 0.4 };
const W = 320;
const PAD = 10;
const x = (v: number) => PAD + ((v + 1) / 2) * (W - PAD * 2);

type Study = { id: string; label: string; net: number; weight: number; findings: string[] };

function studies(state: State, hk: string): Study[] {
  const by = new Map<string, Study & { s: number; r: number }>();
  for (const f of Object.values(state.findings)) {
    const e = f.evidence[hk];
    if (!e) continue;
    const p = by.get(f.paper_id) ?? { id: f.paper_id, label: state.papers[f.paper_id]?.label ?? "", net: 0, weight: 0, findings: [], s: 0, r: 0 };
    p.weight += e.weight;
    if (e.stance === "supports") p.s += e.weight;
    if (e.stance === "refutes") p.r += e.weight;
    p.findings.push(f.id);
    by.set(f.paper_id, p);
  }
  return [...by.values()].map((p) => ({ ...p, net: p.weight ? (p.s - p.r) / p.weight : 0 }));
}

/**
 * A forest plot in miniature: each paper is a square at where its findings lean (refutes on the left,
 * supports on the right), sized by how much weight it carries; the diamond is the pooled verdict, as
 * wide as the evidence is uncertain.
 */
export function EvidenceScale({
  state,
  hk,
  support,
  refute,
  grade,
  tone,
  onRefs,
}: {
  state: State;
  hk: string;
  support: number;
  refute: number;
  grade?: string;
  tone?: keyof typeof TONE;
  onRefs: (r: string[] | null) => void;
}) {
  const rows = useMemo(() => {
    const list = studies(state, hk).sort((a, b) => b.weight - a.weight);
    const max = Math.max(...list.map((s) => s.weight), 1);
    // Three lanes; each square takes the first lane where it doesn't overlap a neighbour.
    const lanes: number[][] = [[], [], []];
    return list.map((s) => {
      const cx = x(s.net);
      const size = 5 + 7 * Math.sqrt(s.weight / max);
      const lane = lanes.findIndex((l) => l.every((o) => Math.abs(o - cx) > size + 1));
      const k = lane < 0 ? 1 : lane;
      lanes[k].push(cx);
      return { ...s, cx, size, cy: 12 + k * 13 };
    });
  }, [state, hk]);

  const net = support - refute;
  const half = (SPREAD[grade ?? ""] ?? 0.3) * ((W - PAD * 2) / 2);
  const color = (tone && TONE[tone]?.color) || "var(--ink-3)";
  const dy = 62;

  return (
    <div>
      <svg viewBox={`0 0 ${W} 80`} className="block w-full overflow-visible" role="img" aria-label={`Pooled lean ${Math.round(net * 100)} on a scale from refutes to supports`}>
        <rect x={PAD} y={2} width={(W - PAD * 2) / 2} height={68} rx={6} fill="var(--neg-soft)" opacity={0.5} />
        <rect x={W / 2} y={2} width={(W - PAD * 2) / 2} height={68} rx={6} fill="var(--pos-soft)" opacity={0.5} />
        <line x1={W / 2} x2={W / 2} y1={2} y2={70} stroke="var(--line-2)" strokeDasharray="2 3" />
        <line x1={PAD} x2={W - PAD} y1={dy} y2={dy} stroke="var(--line-2)" />

        {rows.map((s, i) => (
          <rect
            key={s.id}
            className="tg-study"
            style={{ animationDelay: `${i * 40}ms` }}
            x={s.cx - s.size / 2}
            y={s.cy - s.size / 2}
            width={s.size}
            height={s.size}
            rx={1.5}
            fill={s.net > 0.2 ? STANCE.supports.color : s.net < -0.2 ? STANCE.refutes.color : STANCE.mixed.color}
            onMouseEnter={() => onRefs(s.findings)}
            onMouseLeave={() => onRefs(null)}
          >
            <title>{`${s.label}: ${s.findings.length} finding${s.findings.length === 1 ? "" : "s"}`}</title>
          </rect>
        ))}

        <g className="tg-diamond" style={{ transform: `translateX(${x(net)}px)` }}>
          <path d={`M ${-half} ${dy} L 0 ${dy - 8} L ${half} ${dy} L 0 ${dy + 8} Z`} fill={color} />
        </g>
      </svg>
      <div className="mt-1.5 flex justify-between text-[12px] text-ink-3">
        <span>
          <span className="tabular font-medium" style={{ color: STANCE.refutes.ink }}>{Math.round(refute * 100)}%</span> refutes
        </span>
        <span>No clear lean</span>
        <span>
          supports <span className="tabular font-medium" style={{ color: STANCE.supports.ink }}>{Math.round(support * 100)}%</span>
        </span>
      </div>
    </div>
  );
}

// Illustrative studies for the start screen: [lean, half-width of its interval, weight].
const SAMPLE: [number, number, number][] = [
  [0.42, 0.3, 0.5],
  [0.18, 0.42, 0.35],
  [0.55, 0.22, 0.8],
  [-0.12, 0.36, 0.4],
  [0.3, 0.18, 1],
];

/** The start screen's drawing: studies arrive one by one and pool into the diamond. */
export function HeroPlot() {
  const w = 260;
  const p = 14;
  const at = (v: number) => p + ((v + 1) / 2) * (w - p * 2);
  const pooled = 0.34;
  return (
    <svg viewBox={`0 0 ${w} 132`} className="mx-auto block w-[240px]" aria-hidden>
      <line x1={w / 2} x2={w / 2} y1={4} y2={128} stroke="var(--line-2)" strokeDasharray="2 3" />
      {SAMPLE.map(([lean, half, weight], i) => {
        const y = 14 + i * 18;
        const size = 5 + 6 * weight;
        return (
          <g key={i} className="tg-hero-row" style={{ animationDelay: `${120 + i * 110}ms` }}>
            <line x1={at(lean - half)} x2={at(lean + half)} y1={y} y2={y} stroke="var(--ink-3)" strokeWidth={1.5} strokeLinecap="round" />
            <rect x={at(lean) - size / 2} y={y - size / 2} width={size} height={size} rx={1.5} fill="var(--ink)" />
          </g>
        );
      })}
      <path
        className="tg-hero-diamond"
        d={`M ${at(pooled - 0.16)} 114 L ${at(pooled)} 106 L ${at(pooled + 0.16)} 114 L ${at(pooled)} 122 Z`}
        fill="var(--pos)"
      />
    </svg>
  );
}
