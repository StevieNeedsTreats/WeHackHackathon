"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentRail } from "@/components/AgentRail";
import GraphCanvas from "@/components/graph/GraphCanvas";
import { Header } from "@/components/Header";
import { DetailsPanel } from "@/components/panels/DetailsPanel";
import { EvidencePanel } from "@/components/panels/EvidencePanel";
import { InsightsPanel } from "@/components/panels/InsightsPanel";
import { QueriesPanel } from "@/components/panels/QueriesPanel";
import { StatStrip } from "@/components/StatStrip";
import { getHealth, getSubstances } from "@/lib/api";
import { useResearch } from "@/lib/store";
import type { Health, SubstanceSummary } from "@/lib/types";

type Tab = "insights" | "evidence" | "queries" | "details";
const TABS: { id: Tab; label: string }[] = [
  { id: "insights", label: "Insights" },
  { id: "evidence", label: "Evidence" },
  { id: "queries", label: "Queries" },
  { id: "details", label: "Details" },
];

export default function Home() {
  const { state, run, load, stop } = useResearch();
  const [health, setHealth] = useState<Health | null>(null);
  const [subs, setSubs] = useState<SubstanceSummary[]>([]);
  const [tab, setTab] = useState<Tab>("insights");
  const [selected, setSelected] = useState<string | null>(null);
  const [refs, setRefs] = useState<string[] | null>(null);

  const refresh = useCallback(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getSubstances().then(setSubs).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (state.status === "done") refresh();
  }, [state.status, refresh]);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) setTab("details");
  };
  const start = (q: string, mode: "live" | "demo" = "live") => {
    setSelected(null);
    setTab("insights");
    run(q, mode);
  };

  const empty = (
    <div className="pointer-events-auto max-w-[520px] px-6 text-center">
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">What does the research actually say?</h1>
      <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-[1.6] text-ink-2">
        Name a supplement, drug or intervention. Agents find the papers, pull out every claim, score each source&apos;s credibility, and map where the
        evidence agrees and where it contradicts itself, live into a FalkorDB graph.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button onClick={() => start("Creatine", "demo")} className="rounded-[7px] bg-ink px-4 py-2 text-[13.5px] font-medium text-white hover:opacity-90">
          Watch the creatine demo
        </button>
        <button onClick={() => start("Vitamin D")} className="rounded-[7px] border border-line-2 bg-surface px-4 py-2 text-[13.5px] text-ink hover:border-ink-3">
          Build vitamin D live
        </button>
      </div>
      <p className="mono mt-4 text-[11px] text-ink-3">Press / to search</p>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header state={state} health={health} onRun={(q) => start(q)} onDemo={() => start("Creatine", "demo")} onStop={stop} />
      {state.status !== "idle" && <StatStrip state={state} />}

      {(state.status === "refused" || state.status === "error") && (
        <div role="alert" className="flex flex-wrap items-start gap-3 border-b border-neg bg-neg-soft/60 px-5 py-2.5 text-[13px] text-ink">
          <span className="mono mt-[1px] rounded-[3px] bg-surface px-1.5 text-[10.5px] uppercase tracking-wide text-neg-ink">
            {state.status === "refused" ? "guardrail" : "error"}
          </span>
          <span className="flex-1">{state.status === "refused" ? state.guard?.message : state.error}</span>
          {state.status === "refused" && state.guard?.checks && (
            <span className="mono flex flex-wrap gap-2 text-[11px] text-ink-2">
              {state.guard.checks.map((c) => (
                <span key={c.name}>
                  {c.passed ? "✓" : "✗"} {c.name}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[264px_minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        <div className="order-3 border-t border-line bg-bg lg:order-none lg:min-h-0 lg:border-r lg:border-t-0">
          <AgentRail state={state} substances={subs} onOpen={(k) => {
            setSelected(null);
            setTab("insights");
            load(k);
          }} />
        </div>

        <main className="order-1 h-[64vh] min-h-[420px] lg:order-none lg:h-auto lg:min-h-0" aria-label="Evidence graph">
          <GraphCanvas state={state} selected={selected} onSelect={select} highlight={refs} empty={empty} />
        </main>

        <aside className="order-2 flex h-[72vh] min-h-0 flex-col border-t lg:h-auto border-line bg-surface-2 lg:order-none lg:border-l lg:border-t-0" aria-label="Analysis">
          <div className="flex shrink-0 gap-1 border-b border-line px-3 pt-2" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`relative px-2.5 pb-2 pt-1 text-[13px] ${tab === t.id ? "font-medium text-ink" : "text-ink-3 hover:text-ink-2"}`}
              >
                {t.label}
                {t.id === "evidence" && state.flags.length > 0 && <span className="mono ml-1 text-[10.5px] text-ink-3">{state.flags.length}</span>}
                {tab === t.id && <span className="absolute inset-x-2 bottom-[-1px] h-[2px] rounded-full bg-ink" />}
              </button>
            ))}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {tab === "insights" && <InsightsPanel state={state} onRefs={setRefs} disclaimer={health?.disclaimer} />}
            {tab === "evidence" && <EvidencePanel state={state} onSelect={select} />}
            {tab === "queries" && <QueriesPanel state={state} />}
            {tab === "details" && <DetailsPanel state={state} id={selected} onSelect={select} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
