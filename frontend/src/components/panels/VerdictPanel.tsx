"use client";

import { Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { balance, explanation, papersFor, type State } from "@/lib/store";
import type { Hypothesis, Insight, Verdict } from "@/lib/types";
import { EvidenceScale } from "../EvidenceScale";
import { TONE } from "../graph/glyphs";
import { BalanceBar } from "../graph/nodes";
import { SectionLabel } from "../Tip";

const H = ({ children }: { children: React.ReactNode }) => <SectionLabel className="mb-2.5 mt-7">{children}</SectionLabel>;

const GRADE_TEXT: Record<string, string> = {
  A: "Strong: high-level evidence (reviews or trials) from several papers that largely agree.",
  B: "Moderate: good designs from several papers, with some disagreement.",
  C: "Limited: few papers, weaker designs, or substantial disagreement.",
  D: "Very limited: a single weak study or almost nothing found.",
};

const ISSUE_TEXT: Record<string, string> = {
  "discovery-error": "a literature search failed",
  "extract-error": "some papers couldn't be read",
  "credibility-error": "some papers couldn't be scored",
  "stance-missing": "some findings got no stance",
  "verdict-error": "the verdict write-up failed",
  budget: "the run ran out of its token budget",
  timeout: "the run hit its time limit",
  "orchestrator-error": "the planner failed",
  incomplete: "the run stopped early",
  interrupted: "the run was interrupted",
};

/** The last run's outcome, shown once a run isn't streaming (mid-run the stored status is a placeholder). */
export function runIssue(h: Hypothesis, streaming: boolean): { title: string; body: string } | null {
  if (streaming || !h.status || h.status === "complete") return null;
  const what = (h.issues ?? []).map((i) => ISSUE_TEXT[i] ?? i).join("; ") || "something went wrong";
  return h.status === "degraded"
    ? { title: "Partial evidence", body: `This verdict was reached without some of its evidence: ${what}. It will be researched again the next time it's asked.` }
    : { title: "Incomplete run", body: `The last run didn't reach a verdict: ${what}. It will be researched again the next time it's asked.` };
}

export function GradeBadge({ v }: { v: Pick<Verdict, "grade" | "tone" | "verdict"> }) {
  const t = TONE[v.tone] ?? TONE.neutral;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge className="h-6 rounded-full px-2.5 text-[12.5px] font-semibold" style={{ background: t.soft, color: t.ink }}>
        {v.verdict}
      </Badge>
      <Badge variant="outline" className="h-6 rounded-full px-2 text-[12.5px] font-medium text-ink-2" title={GRADE_TEXT[v.grade]}>
        Grade {v.grade}
      </Badge>
    </span>
  );
}

function InsightRow({ i, onRefs }: { i: Insight; onRefs: (r: string[] | null) => void }) {
  const t = TONE[i.tone] ?? TONE.neutral;
  return (
    <li
      className="group -mx-2 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2"
      onMouseEnter={() => i.refs.length && onRefs(i.refs)}
      onMouseLeave={() => onRefs(null)}
    >
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="size-2 shrink-0 translate-y-[-1px] rotate-45 rounded-[1px]" style={{ background: t.color }} />
        <span className="text-[13.5px] font-semibold text-ink">{i.title}</span>
        {i.refs.length > 0 && <span className="tabular ml-auto shrink-0 text-[12px] text-ink-3 group-hover:text-ink-2">{i.refs.length} finding{i.refs.length > 1 ? "s" : ""}</span>}
      </div>
      <p className="mt-0.5 pl-4 text-[13px] leading-[1.55] text-ink-2">{i.body}</p>
    </li>
  );
}

export function VerdictPanel({ state, hk, onRefs, onSelect }: { state: State; hk: string | null; onRefs: (r: string[] | null) => void; onSelect: (id: string) => void }) {
  if (!hk || !state.hyps[hk]) {
    return <p className="p-5 text-[13px] text-muted-foreground">Pick a hypothesis above to see its verdict.</p>;
  }
  const h = state.hyps[hk];
  const v = state.verdicts[hk];
  const b = balance(state, hk);
  const papers = papersFor(state, hk);
  const clusters = Object.values(state.clusters).filter((c) => c.hypothesis === hk);
  const contra = state.contradictions[hk] ?? [];
  const issue = runIssue(h, state.status === "streaming");

  return (
    <div className="p-5">
      <h2 className="text-[19px] font-semibold leading-[1.3] tracking-[-0.015em] text-balance text-ink">{h.statement}</h2>
      {h.population && <div className="mt-1 text-[12.5px] text-ink-3">In {h.population.name}</div>}

      {state.notice && (
        <Alert className="mt-3 border-neu/50 bg-neu-soft/60">
          <TriangleAlert />
          <AlertDescription className="text-[12px] text-ink-2">{state.notice}</AlertDescription>
        </Alert>
      )}

      <div className="mt-3.5">
        {v ? <GradeBadge v={v} /> : <span className="text-[12.5px] text-ink-3">{state.status === "streaming" ? "Researching…" : "No verdict yet"}</span>}
        {v && <p className="mt-2 text-[12.5px] leading-snug text-ink-3">{GRADE_TEXT[v.grade]}</p>}
      </div>

      {issue && (
        <Alert className="mt-3 border-neu/50 bg-neu-soft/60">
          <TriangleAlert />
          <AlertTitle className="text-[12.5px] text-ink">{issue.title}</AlertTitle>
          <AlertDescription className="text-[12px] text-ink-2">{issue.body}</AlertDescription>
        </Alert>
      )}

      <div className="mt-5 rounded-xl border bg-surface-2 p-3 pb-2.5">
        <EvidenceScale state={state} hk={hk} support={b.support} refute={b.refute} grade={v?.grade} tone={v?.tone as keyof typeof TONE | undefined} onRefs={onRefs} />
      </div>
      <p className="mt-2 text-[12px] leading-snug text-ink-3">
        Each square is a paper, placed by where its findings lean and sized by credibility and relevance. The diamond is the pooled result. {v ? `${v.findings} findings from ${v.papers} papers` : `${b.total} findings judged`}
        {v?.best_design ? `; strongest design: ${v.best_design}.` : "."}
      </p>

      {v?.summary && (
        <>
          <H>Summary</H>
          <p className="text-[14px] leading-[1.65] text-ink">{v.summary}</p>
        </>
      )}

      {v && v.insights.length > 0 && (
        <>
          <H>Insights</H>
          <ul className="divide-y divide-line">
            {v.insights.map((i, k) => (
              <InsightRow key={k} i={i} onRefs={onRefs} />
            ))}
          </ul>
        </>
      )}

      {clusters.length > 0 && (
        <>
          <H>Clusters</H>
          <ul className="space-y-2">
            {clusters.map((c) => {
              const cb = v?.clusters[c.id];
              const t = cb ? cb.supports + cb.refutes + cb.mixed || 1 : 1;
              return (
                <li key={c.id} className="rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors" onMouseEnter={() => onRefs(c.findings)} onMouseLeave={() => onRefs(null)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-ink">{c.label}</span>
                    <span className="text-[12px] text-ink-3">{c.findings.length} findings</span>
                  </div>
                  <div className="text-[12.5px] text-ink-3">{c.context}</div>
                  {cb && <BalanceBar support={cb.supports / t} refute={cb.refutes / t} mixed={cb.mixed / t} className="mt-1.5 h-[5px]" />}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {contra.length > 0 && (
        <>
          <H>Contradictions</H>
          <ul className="space-y-1.5">
            {contra.map((c) => {
              const a = state.findings[c.a];
              const bf = state.findings[c.b];
              return (
                <li key={`${c.a}-${c.b}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(`c:${c.a}:${c.b}`)}
                    onMouseEnter={() => onRefs([c.a, c.b])}
                    onMouseLeave={() => onRefs(null)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors text-left hover:border-line-2 hover:bg-surface-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[12px]" style={{ color: c.explained_by ? "var(--ink-3)" : "var(--neg-ink)" }}>
                        {c.reason}
                      </span>
                      <span className="ml-auto text-[12px] text-ink-3">{c.severity}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-ink-2">
                      {state.papers[a?.paper_id ?? ""]?.label ?? "?"} vs {state.papers[bf?.paper_id ?? ""]?.label ?? "?"}
                    </div>
                    {c.explained_by && <div className="text-[12.5px] text-ink-3">{explanation(c) ? `Explained by: ${explanation(c)}` : "Explained by this study difference"}</div>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {v && Object.keys(v.funding).length > 0 && (
        <>
          <H>Who funded each side</H>
          <ul className="space-y-1">
            {Object.entries(v.funding).map(([type, d]) => {
              const t = d.supports + d.refutes + d.mixed || 1;
              return (
                <li key={type} className="flex items-center gap-2 text-[12px]">
                  <span className="w-[86px] shrink-0 capitalize text-ink-2">{type}</span>
                  <BalanceBar support={d.supports / t} refute={d.refutes / t} mixed={d.mixed / t} className="h-[6px] flex-1" />
                  <span className="w-[28px] text-right text-[12px] text-ink-3">{t}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(v?.gaps?.length || (state.status === "done" && papers.length < 4)) && (
        <>
          <H>Gaps</H>
          <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-ink-2">
            {papers.length < 4 && <li>Only {papers.length} relevant paper{papers.length === 1 ? "" : "s"} found.</li>}
            {v?.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
          {v?.search_note && <p className="mt-2 text-[12.5px] text-ink-3">{v.search_note}</p>}
        </>
      )}

      {state.disclaimer && (
        <Alert className="mt-6 bg-surface-2">
          <Info />
          <AlertDescription className="text-[12.5px] text-ink-3">{state.disclaimer}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
