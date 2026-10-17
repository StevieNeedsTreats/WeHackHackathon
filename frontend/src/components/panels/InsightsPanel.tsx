"use client";

import { useState } from "react";
import type { State } from "@/lib/store";
import type { Consensus, InsightItem } from "@/lib/types";
import { DIR } from "../graph/glyphs";

const KIND_LABEL: Record<InsightItem["kind"], string> = {
  headline: "Headline",
  finding: "Finding",
  safety: "Safety",
  conflict: "Conflict",
  funding: "Funding",
  gap: "Gap",
  quality: "Quality",
};

export function InsightsPanel({ state, onRefs, disclaimer }: { state: State; onRefs: (ids: string[] | null) => void; disclaimer?: string }) {
  const ins = state.insights;
  if (!ins) {
    return (
      <div className="space-y-3 p-5">
        <p className="text-[13px] text-ink-3">{state.status === "streaming" ? "Insights appear once claims are grouped and contradictions mapped." : "Build a graph to see insights."}</p>
        {state.status === "streaming" && [0, 1, 2].map((i) => <div key={i} className="tg-shimmer h-16 rounded-[8px]" />)}
      </div>
    );
  }
  return (
    <div className="space-y-6 p-5">
      {(state.narrative || ins.narrative) && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Summary</h3>
          <p className="font-serif text-[15px] leading-[1.6] text-ink">{state.narrative || ins.narrative}</p>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">What the evidence says</h3>
        <ul className="space-y-2">
          {ins.items.map((it, i) => (
            <li key={i}>
              <button
                onMouseEnter={() => it.refs.length && onRefs(it.refs.map((r) => `c:${r}`))}
                onMouseLeave={() => onRefs(null)}
                onFocus={() => it.refs.length && onRefs(it.refs.map((r) => `c:${r}`))}
                onBlur={() => onRefs(null)}
                className="group w-full rounded-[8px] border border-line bg-surface p-3 text-left transition-colors hover:border-ink-3"
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DIR[it.tone].color }} aria-hidden />
                  <span className="mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{KIND_LABEL[it.kind]}</span>
                  {it.refs.length > 0 && <span className="mono ml-auto text-[10px] text-ink-4 group-hover:text-ink-3">{it.refs.length} on graph</span>}
                </div>
                <div className="mt-1 text-[13.5px] font-semibold leading-snug text-ink">{it.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-[1.5] text-ink-2">{it.body}</p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <ConsensusChart rows={ins.consensus} onRefs={onRefs} />

      {disclaimer && <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">{disclaimer}</p>}
    </div>
  );
}

/** 100% stacked bars of credibility-weighted evidence per outcome. */
function ConsensusChart({ rows, onRefs }: { rows: Consensus[]; onRefs: (ids: string[] | null) => void }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  return (
    <section className="relative">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Consensus by outcome</h3>
        <span className="text-[10.5px] text-ink-3">weighted by credibility</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2" aria-label="legend">
        {(["positive", "neutral", "null"] as const).map((d) => (
          <span key={d} className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[2px]" style={{ background: DIR[d].color }} />
            {DIR[d].label}
          </span>
        ))}
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.outcome_key} onMouseEnter={() => onRefs(r.claim_ids.map((c) => `c:${c}`))} onMouseLeave={() => onRefs(null)}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[12.5px] font-medium text-ink">{r.outcome}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-[11px] text-ink-3">{r.verdict}</span>
                <span className="mono rounded-[3px] bg-ink px-1 text-[10px] leading-[15px] text-white" title="Evidence grade">
                  {r.grade}
                </span>
              </span>
            </div>
            <div className="flex h-[10px] gap-[2px]">
              {(["positive", "neutral", "null"] as const).map((k) =>
                r.share[k] > 0 ? (
                  <span
                    key={k}
                    className="h-full cursor-default first:rounded-l-[4px] last:rounded-r-[4px]"
                    style={{ flex: r.share[k], background: DIR[k].color }}
                    onMouseMove={(e) => {
                      const box = (e.currentTarget.closest("section") as HTMLElement).getBoundingClientRect();
                      setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: `${DIR[k].label}: ${Math.round(r.share[k] * 100)}% of weight` });
                    }}
                    onMouseLeave={() => setTip(null)}
                  />
                ) : null,
              )}
            </div>
            <div className="mono mt-1 flex justify-between text-[10.5px] text-ink-3">
              <span className="tabular">{Math.round(r.share.positive * 100)}% positive</span>
              <span className="tabular">
                {r.papers} paper{r.papers !== 1 ? "s" : ""} · {r.claims} claim{r.claims !== 1 ? "s" : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {tip && (
        <div
          className="mono pointer-events-none absolute z-10 rounded-[5px] border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink shadow-[var(--shadow-md)]"
          style={{ left: tip.x + 10, top: tip.y - 30 }}
        >
          {tip.text}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
        Grade A: a review-level study plus agreement across ≥2 papers. B: ≥2 trials mostly agreeing. C: one trial or weak agreement. D: a single non-trial source.
      </p>
    </section>
  );
}
