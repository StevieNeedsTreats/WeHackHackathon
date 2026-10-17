"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { State } from "@/lib/store";
import type { Consensus, InsightItem } from "@/lib/types";
import { DIR } from "../graph/glyphs";
import { SectionLabel, Tip } from "../Tip";

const KIND_LABEL: Record<InsightItem["kind"], string> = {
  headline: "Headline",
  finding: "Finding",
  safety: "Safety",
  conflict: "Conflict",
  funding: "Funding",
  gap: "Gap",
  quality: "Quality",
};

export function GradeBadge({ grade, verdict }: { grade: string; verdict?: string }) {
  return (
    <Tip label={verdict ? `Evidence grade ${grade}: ${verdict}` : `Evidence grade ${grade}`}>
      <Badge className="mono h-4 rounded-sm px-1 text-[10px]">{grade}</Badge>
    </Tip>
  );
}

export function InsightsPanel({ state, onRefs, disclaimer }: { state: State; onRefs: (ids: string[] | null) => void; disclaimer?: string }) {
  const ins = state.insights;
  if (!ins) {
    return (
      <div className="space-y-3 p-5">
        <p className="text-[13px] text-muted-foreground">
          {state.status === "streaming" ? "Insights appear once claims are grouped and contradictions mapped." : "Build a graph to see insights."}
        </p>
        {state.status === "streaming" && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] rounded-lg" />)}
      </div>
    );
  }
  return (
    <div className="space-y-6 p-5">
      {(state.narrative || ins.narrative) && (
        <section>
          <SectionLabel className="mb-2">Summary</SectionLabel>
          <p className="font-serif text-[15px] leading-[1.6] text-foreground">{state.narrative || ins.narrative}</p>
        </section>
      )}

      <section>
        <SectionLabel className="mb-2">What the evidence says</SectionLabel>
        <ul className="space-y-2">
          {ins.items.map((it, i) => {
            const show = () => it.refs.length && onRefs(it.refs.map((r) => `c:${r}`));
            return (
              <li key={i}>
                <Card
                  size="sm"
                  tabIndex={0}
                  onMouseEnter={show}
                  onMouseLeave={() => onRefs(null)}
                  onFocus={show}
                  onBlur={() => onRefs(null)}
                  className="group gap-1 px-3 shadow-none outline-none transition-shadow hover:ring-ink-3 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: DIR[it.tone].color }} aria-hidden />
                    <span className="mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{KIND_LABEL[it.kind]}</span>
                    {it.refs.length > 0 && (
                      <Badge variant="outline" className="mono ml-auto h-4 rounded-sm px-1 text-[10px] font-normal text-muted-foreground group-hover:text-foreground">
                        {it.refs.length} on graph
                      </Badge>
                    )}
                  </div>
                  <div className="text-[13.5px] font-semibold leading-snug text-foreground">{it.title}</div>
                  <p className="text-[12.5px] leading-[1.5] text-ink-2">{it.body}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <ConsensusChart rows={ins.consensus} onRefs={onRefs} />

      {disclaimer && (
        <>
          <Separator />
          <p className="text-[11px] leading-relaxed text-muted-foreground">{disclaimer}</p>
        </>
      )}
    </div>
  );
}

/** 100% stacked bars of credibility-weighted evidence per outcome. */
function ConsensusChart({ rows, onRefs }: { rows: Consensus[]; onRefs: (ids: string[] | null) => void }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between">
        <SectionLabel>Consensus by outcome</SectionLabel>
        <span className="text-[10.5px] text-muted-foreground">weighted by credibility</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2" aria-label="legend">
        {(["positive", "neutral", "null"] as const).map((d) => (
          <span key={d} className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[2px]" style={{ background: DIR[d].color }} />
            {DIR[d].label}
          </span>
        ))}
      </div>
      <Card size="sm" className="gap-3 px-3 shadow-none">
        {rows.map((r) => (
          <div key={r.outcome_key} onMouseEnter={() => onRefs(r.claim_ids.map((c) => `c:${c}`))} onMouseLeave={() => onRefs(null)}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[12.5px] font-medium text-foreground">{r.outcome}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{r.verdict}</span>
                <GradeBadge grade={r.grade} verdict={r.verdict} />
              </span>
            </div>
            <div className="flex h-[10px] gap-[2px]">
              {(["positive", "neutral", "null"] as const).map((k) =>
                r.share[k] > 0 ? (
                  <Tip key={k} label={`${DIR[k].label}: ${Math.round(r.share[k] * 100)}% of weight`}>
                    <span className="h-full cursor-default first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flex: r.share[k], background: DIR[k].color }} />
                  </Tip>
                ) : null,
              )}
            </div>
            <div className="mono mt-1 flex justify-between text-[10.5px] text-muted-foreground">
              <span className="tabular">{Math.round(r.share.positive * 100)}% positive</span>
              <span className="tabular">
                {r.papers} paper{r.papers !== 1 ? "s" : ""} · {r.claims} claim{r.claims !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        ))}
      </Card>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Grade A: a review-level study plus agreement across ≥2 papers. B: ≥2 trials mostly agreeing. C: one trial or weak agreement. D: a single non-trial source.
      </p>
    </section>
  );
}
