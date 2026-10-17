"use client";

import { LoaderCircle } from "lucide-react";
import { balance, type State } from "@/lib/store";
import { STANCE, TONE } from "./graph/glyphs";
import { BalanceBar } from "./graph/nodes";
import { runIssue } from "./panels/VerdictPanel";

export type Focus = string | "all" | "compare";

const STAGE: Record<string, string> = {
  discovery: "Searching",
  stance: "Judging",
  contradictions: "Mapping conflicts",
  verdict: "Writing verdict",
  done: "Done",
};

/** One card per hypothesis with live status and balance; plus All and Compare. */
export function HypothesisBar({ state, focus, onFocus }: { state: State; focus: Focus; onFocus: (f: Focus) => void }) {
  if (!state.hypOrder.length) return null;
  const tab = (id: Focus, active: boolean, children: React.ReactNode, wide = true) => (
    <button
      key={id}
      type="button"
      onClick={() => onFocus(id)}
      aria-pressed={active}
      className={`flex shrink-0 flex-col justify-center rounded-lg border px-3 py-2 text-left transition-colors ${wide ? "w-[260px]" : "w-auto"} ${
        active ? "border-ink bg-card shadow-[var(--shadow-sm)]" : "border-line bg-surface-2 hover:border-ink-3"
      }`}
    >
      {children}
    </button>
  );
  return (
    <nav className="flex gap-2 overflow-x-auto border-b bg-surface-2 px-4 py-2 md:px-5" aria-label="Hypotheses">
      {state.hypOrder.map((k, i) => {
        const h = state.hyps[k];
        const v = state.verdicts[k];
        const b = balance(state, k);
        const running = state.status === "streaming" && !v && !h.reused;
        const issue = runIssue(h, state.status === "streaming");
        return tab(
          k,
          focus === k,
          <>
            <div className="flex items-center gap-1.5">
              <span className="mono text-[10px] text-ink-3">H{i + 1}</span>
              {v ? (
                <span className="mono rounded-sm px-1 text-[10px] text-white" style={{ background: (TONE[v.tone] ?? TONE.neutral).color }}>
                  {v.verdict} · {v.grade}
                </span>
              ) : h.verdict && !running ? (
                <span className="mono text-[10px] text-ink-2">
                  {h.verdict} · {h.grade}
                </span>
              ) : (
                <span className="mono flex items-center gap-1 text-[10px] text-ink-3">
                  {running && <LoaderCircle size={10} className="animate-spin" />}
                  {h.reused ? "Reused" : STAGE[h.stage ?? "discovery"]}
                  {h.papers ? ` · ${h.papers} papers` : ""}
                </span>
              )}
              {issue && (
                <span className="mono ml-auto text-[10px] text-ink-3" title={issue.body}>
                  {issue.title === "Partial evidence" ? "partial" : "incomplete"}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[12.5px] font-medium text-ink" title={h.statement}>
              {h.statement}
            </div>
            <BalanceBar support={b.support} refute={b.refute} mixed={b.mixed} className="mt-1.5 h-[5px]" />
            <div className="mono mt-0.5 flex justify-between text-[9.5px]">
              <span style={{ color: STANCE.supports.ink }}>{Math.round(b.support * 100)}%</span>
              <span style={{ color: STANCE.refutes.ink }}>{Math.round(b.refute * 100)}%</span>
            </div>
          </>,
        );
      })}
      {state.hypOrder.length > 1 && tab("compare", focus === "compare", <span className="text-[12.5px] font-medium text-ink">Compare</span>, false)}
      {tab("all", focus === "all", <span className="text-[12.5px] font-medium text-ink">All</span>, false)}
    </nav>
  );
}
