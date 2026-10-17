"use client";

import { Separator } from "@/components/ui/separator";
import type { State } from "@/lib/store";
import { DIR } from "./graph/glyphs";
import { Tip } from "./Tip";

function Stat({ label, hint, value, sub, children }: { label: string; hint: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Tip label={hint} side="bottom">
      <div className="min-w-[96px] shrink-0 cursor-default px-4 py-2">
        <div className="whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.11em] text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="tabular text-[20px] font-semibold leading-7 tracking-[-0.02em] text-foreground">{value}</span>
          {sub && <span className="mono tabular whitespace-nowrap text-[11px] text-muted-foreground">{sub}</span>}
        </div>
        {children}
      </div>
    </Tip>
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

  const items = [
    <Stat key="p" label="Papers" hint="Papers with abstracts linked to this substance" value={papers} />,
    <Stat key="c" label="Claims" hint="Positive + / mixed ~ / negative − findings extracted" value={claims.length} sub={`${dirs.positive}+ ${dirs.neutral}~ ${dirs.null}−`}>
      <div className="mt-1 flex h-[4px] w-[112px] gap-[2px]" aria-hidden>
        {claims.length > 0 &&
          (["positive", "neutral", "null"] as const).map((k) =>
            dirs[k] ? <span key={k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flex: dirs[k] / total, background: DIR[k].color }} /> : null,
          )}
      </div>
    </Stat>,
    <Stat key="x" label="Contradictions" hint="CONTRADICTS edges between papers' claims" value={contradictions} />,
    <Stat key="f" label="Validation flags" hint="Small samples, undisclosed funding, unverified quotes…" value={state.flags.length} />,
    <Stat key="t" label="Build time" hint="End to end, from search to insights" value={state.stats ? (state.stats.elapsed_ms / 1000).toFixed(1) : "—"} sub={state.stats ? "s" : undefined} />,
    <Stat key="q" label="Multi-hop query" hint="Median of five 3–6 hop benchmark queries" value={median != null ? median.toFixed(2) : "—"} sub={median != null ? "ms median" : undefined} />,
    <Stat
      key="g"
      label="Graph"
      hint="Whole FalkorDB graph, shared across substances"
      value={state.stats ? state.stats.graph_nodes.toLocaleString() : "—"}
      sub={state.stats ? `nodes · ${state.stats.graph_edges.toLocaleString()} edges` : undefined}
    />,
  ];

  return (
    <div className="scroll-thin flex items-stretch overflow-x-auto border-b bg-card px-1 md:px-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex shrink-0 items-stretch">
          {i > 0 && <Separator orientation="vertical" className="h-auto" />}
          {it}
        </div>
      ))}
    </div>
  );
}
