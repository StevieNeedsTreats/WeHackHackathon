"use client";

import { AGENT_ORDER, type State } from "@/lib/store";
import type { AgentState, SubstanceSummary } from "@/lib/types";

function StatusIcon({ s }: { s: AgentState["status"] }) {
  if (s === "running")
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" className="tg-spin text-ink" aria-label="running">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--line-2)" strokeWidth="1.6" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (s === "done")
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-label="done">
        <circle cx="8" cy="8" r="7" fill="var(--ink)" />
        <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (s === "error")
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-label="error">
        <circle cx="8" cy="8" r="7" fill="var(--neg)" />
        <path d="M8 4.5v4M8 11v.01" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-label="queued">
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--line-2)" strokeWidth="1.6" />
    </svg>
  );
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export function AgentRail({ state, substances, onOpen }: { state: State; substances: SubstanceSummary[]; onOpen: (key: string) => void }) {
  return (
    <aside className="scroll-thin flex h-full flex-col overflow-y-auto">
      <div className="px-4 pb-2 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Agents</h2>
          {state.engine && state.status !== "idle" && (
            <span className="mono text-[10px] text-ink-3">{state.engine === "claude" ? "claude-haiku-5-5" : "rule extractor"}</span>
          )}
        </div>
      </div>
      <ol className="relative px-4">
        {AGENT_ORDER.map((a, i) => {
          const ag = state.agents[a.id];
          const pct = ag.total ? Math.min(100, ((ag.done ?? 0) / ag.total) * 100) : ag.status === "done" ? 100 : 0;
          return (
            <li key={a.id} className="relative flex gap-3 pb-4">
              {i < AGENT_ORDER.length - 1 && (
                <span aria-hidden className="absolute left-[7.5px] top-[20px] h-[calc(100%-18px)] w-px" style={{ background: ag.status === "done" ? "var(--ink-3)" : "var(--line)" }} />
              )}
              <div className="relative z-[1] mt-[1px] bg-bg">
                <StatusIcon s={ag.status} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[13px] font-medium ${ag.status === "queued" ? "text-ink-3" : "text-ink"}`}>{a.name}</span>
                  {ag.status !== "queued" && ag.ms > 0 && <span className="mono tabular shrink-0 text-[10.5px] text-ink-3">{fmtMs(ag.ms)}</span>}
                </div>
                <div className={`mt-0.5 text-[11.5px] leading-snug ${ag.detail ? "text-ink-2" : "text-ink-3"}`}>{ag.detail || a.role}</div>
                {ag.status === "running" && ag.total ? (
                  <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${pct}%` }} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {state.log.length > 0 && (
        <div className="mx-4 mb-4 rounded-[8px] border border-line bg-surface-2 p-2.5">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">Activity</div>
          <ul className="mono space-y-1 text-[10.5px] leading-snug text-ink-2">
            {state.log.slice(-7).map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="tabular w-[38px] shrink-0 text-right text-ink-4">{fmtMs(l.t)}</span>
                <span className="truncate">{l.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto border-t border-line px-4 py-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">In the graph</h2>
        {substances.length === 0 ? (
          <p className="text-[12px] text-ink-3">Nothing built yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {substances.map((s) => (
              <li key={s.key}>
                <button
                  onClick={() => onOpen(s.key)}
                  className={`flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-3 ${state.key === s.key ? "bg-surface-3 font-medium text-ink" : "text-ink-2"}`}
                >
                  <span className="truncate">
                    {s.name}
                    {s.key.endsWith("-demo") && <span className="ml-1.5 text-[10px] text-ink-3">demo</span>}
                  </span>
                  <span className="mono tabular shrink-0 text-[10.5px] text-ink-3">
                    {s.papers}p · {s.claims}c
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
