"use client";

import { useMemo, useState } from "react";
import type { State } from "@/lib/store";
import type { Direction } from "@/lib/types";
import { DIR, DirGlyph, Icon } from "../graph/glyphs";

const FLAG_LABEL: Record<string, string> = {
  "small-sample": "Small sample (<30)",
  "sample-unreported": "Sample size not stated",
  preprint: "Preprint",
  "industry-funded": "Industry funded",
  "funding-undisclosed": "No funder listed",
  "animal-study": "Animal study",
  retracted: "Retracted",
  "low-credibility": "Credibility < 45",
  "unverified-quote": "Quote not verbatim",
  "no-effect-size": "No effect size",
  "source-error": "Source error",
};

export function EvidencePanel({ state, onSelect }: { state: State; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Direction | "all" | "flagged">("all");
  const claims = useMemo(() => Object.values(state.nodes).filter((n) => n.kind === "claim"), [state.nodes]);
  const papers = state.nodes;
  const contradicted = useMemo(() => {
    const s = new Set<string>();
    for (const e of Object.values(state.edges)) if (e.type === "CONTRADICTS") {
        s.add(e.source);
        s.add(e.target);
      }
    return s;
  }, [state.edges]);

  const rows = claims
    .filter((c) => (filter === "all" ? true : filter === "flagged" ? (c.flags?.length ?? 0) > 0 || contradicted.has(c.id) : c.direction === filter))
    .sort((a, b) => (papers[`p:${b.paper_id}`]?.credibility ?? 0) - (papers[`p:${a.paper_id}`]?.credibility ?? 0));

  const flagCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of state.flags) m[f.code] = (m[f.code] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [state.flags]);

  const chips: { id: typeof filter; label: string }[] = [
    { id: "all", label: `All ${claims.length}` },
    { id: "positive", label: "Positive" },
    { id: "neutral", label: "Mixed" },
    { id: "null", label: "Negative" },
    { id: "flagged", label: "Flagged" },
  ];

  return (
    <div className="p-5">
      <section className="mb-5">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Validation</h3>
        {flagCounts.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">No flags raised.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5">
            {flagCounts.map(([code, n]) => (
              <li key={code} className="flex items-center justify-between rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[12px]">
                <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                  <Icon name="flag" size={11} className="shrink-0 text-ink-3" />
                  <span className="truncate">{FLAG_LABEL[code] ?? code}</span>
                </span>
                <span className="mono tabular text-ink">{n}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Every claim&apos;s quote is checked verbatim against its abstract. Unverified claims count half in consensus.
        </p>
      </section>

      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Filter claims">
        {chips.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={filter === c.id}
            onClick={() => setFilter(c.id)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] ${filter === c.id ? "border-ink bg-ink text-white" : "border-line-2 bg-surface text-ink-2 hover:border-ink-3"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-line rounded-[8px] border border-line bg-surface">
        {rows.map((c) => {
          const p = papers[`p:${c.paper_id}`];
          return (
            <li key={c.id}>
              <button onClick={() => onSelect(c.id)} className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2">
                <DirGlyph dir={c.direction ?? "neutral"} size={16} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium text-ink">{c.text}</span>
                    {contradicted.has(c.id) && (
                      <span className="mono shrink-0 text-[9.5px] uppercase tracking-wider" style={{ color: DIR.null.ink }}>
                        contested
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                    <span className="truncate">{p?.label}</span>
                    <span>·</span>
                    <span className="mono tabular">cred {p?.credibility ?? "—"}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {c.quote_verified ? <Icon name="check" size={11} className="text-ok" /> : <Icon name="alert" size={11} />}
                      <span>{c.quote_verified ? "verified" : "unverified"}</span>
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-3 py-4 text-[12.5px] text-ink-3">No claims match.</li>}
      </ul>
    </div>
  );
}
