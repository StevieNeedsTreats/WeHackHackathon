"use client";

import type { State } from "@/lib/store";
import { DIR } from "./graph/glyphs";

function Stat({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-[96px] px-4 py-2 first:pl-0">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.11em] text-ink-3">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="tabular text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink">{value}</span>
        {sub && <span className="mono tabular text-[11px] text-ink-3">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function StatStrip({ state }: { state: State }) {
  const nodes = Object.values(state.nodes);
  const papers = nodes.filter((n) => n.kind === "paper").length;
  const claims = nodes.filter((n) => n.kind === "claim");
  const dirs = { positive: 0, neutral: 0, null: 0 };
  for (const c of claims) dirs[c.direction ?? "neutral"]++;
  const contradictions = Object.values(state.edges).filter((e) => e.type === "CONTRADICTS").length;
  const median = state.metrics?.length
    ? [...state.metrics].map((m) => m.median_ms).sort((a, b) => a - b)[Math.floor(state.metrics.length / 2)]
    : null;
  const total = claims.length || 1;

  return (
    <div className="scroll-thin flex items-stretch divide-x divide-line overflow-x-auto border-b border-line bg-surface px-4 md:px-5">
      <Stat label="Papers" value={papers} />
      <Stat label="Claims" value={claims.length} sub={`${dirs.positive}+ ${dirs.neutral}~ ${dirs.null}−`}>
        <div className="mt-1 flex h-[4px] w-[112px] gap-[2px]" aria-hidden>
          {claims.length > 0 &&
            (["positive", "neutral", "null"] as const).map((k) =>
              dirs[k] ? <span key={k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flex: dirs[k] / total, background: DIR[k].color }} /> : null,
            )}
        </div>
      </Stat>
      <Stat label="Contradictions" value={contradictions} />
      <Stat label="Validation flags" value={state.flags.length} />
      <Stat label="Build time" value={state.stats ? (state.stats.elapsed_ms / 1000).toFixed(1) : "—"} sub={state.stats ? "s" : undefined} />
      <Stat label="Multi-hop query" value={median != null ? median.toFixed(2) : "—"} sub={median != null ? "ms median" : undefined} />
      <Stat
        label="Graph"
        value={state.stats ? state.stats.graph_nodes.toLocaleString() : "—"}
        sub={state.stats ? `nodes · ${state.stats.graph_edges.toLocaleString()} edges` : undefined}
      />
    </div>
  );
}
