"use client";

import { useState } from "react";
import { getBenchmarks, runQuery, type QueryResult } from "@/lib/api";
import type { State } from "@/lib/store";
import type { Metric } from "@/lib/types";

function Cell({ v }: { v: unknown }) {
  if (v == null) return <span className="text-ink-4">null</span>;
  if (Array.isArray(v)) return <span>{v.map((x) => (typeof x === "object" ? "{…}" : String(x))).join(", ")}</span>;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return <span title={JSON.stringify(o).slice(0, 400)}>{String(o.label ?? o.name ?? o.text ?? o.title ?? `(${(o.labels as string[])?.join(":") ?? "obj"})`)}</span>;
  }
  return <span>{String(v)}</span>;
}

function Table({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  return (
    <div className="scroll-thin max-h-[220px] overflow-auto rounded-[6px] border border-line">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            {columns.map((c) => (
              <th key={c} className="mono whitespace-nowrap border-b border-line px-2 py-1 font-medium text-ink-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-surface even:bg-surface-2/60">
              {r.map((v, j) => (
                <td key={j} className="max-w-[180px] truncate px-2 py-1 align-top text-ink-2">
                  <Cell v={v} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The property-graph model, drawn as a schema. */
function Schema() {
  const N = ({ x, y, label, dark }: { x: number; y: number; label: string; dark?: boolean }) => (
    <g>
      <rect x={x - 40} y={y - 11} width="80" height="22" rx="5" fill={dark ? "var(--ink)" : "var(--surface)"} stroke={dark ? "var(--ink)" : "var(--line-2)"} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="10.5" fill={dark ? "#fff" : "var(--ink)"} fontWeight="500">
        {label}
      </text>
    </g>
  );
  const E = ({ d, label, lx, ly, color = "var(--ink-4)", dash }: { d: string; label: string; lx: number; ly: number; color?: string; dash?: string }) => (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" strokeDasharray={dash} markerEnd="url(#arr)" />
      <text x={lx} y={ly} fontSize="8.5" fill="var(--ink-3)" className="mono" textAnchor="middle">
        {label}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 340 250" className="w-full" role="img" aria-label="Graph schema">
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8z" fill="var(--ink-3)" />
        </marker>
      </defs>
      <E d="M170,31 L170,72" label="STUDIED_IN" lx={208} ly={55} />
      <E d="M130,86 L66,124" label="AUTHORED_BY" lx={70} ly={100} />
      <E d="M170,95 L170,124" label="FROM_LAB" lx={196} ly={113} />
      <E d="M210,86 L274,124" label="FUNDED_BY" lx={272} ly={100} />
      <E d="M150,95 C110,150 120,170 120,183" label="REPORTS" lx={102} ly={158} />
      <E d="M160,195 L230,195" label="ABOUT" lx={195} ly={188} />
      <E d="M210,78 C250,60 250,100 212,90" label="CITES" lx={262} ly={74} dash="2 3" />
      <E d="M100,205 C80,245 160,245 135,206" label="CONTRADICTS · SUPPORTS" lx={120} ly={244} color="var(--neg)" dash="5 3" />
      <N x={170} y={20} label="Substance" dark />
      <N x={170} y={84} label="Paper" />
      <N x={40} y={136} label="Author" />
      <N x={170} y={136} label="Lab" />
      <N x={300} y={136} label="Funder" />
      <N x={120} y={195} label="Claim" />
      <N x={270} y={195} label="Outcome" />
    </svg>
  );
}

const EXAMPLE = `MATCH (f:Funder)<-[:FUNDED_BY]-(p:Paper)-[:REPORTS]->(c:Claim {substance:$k})
RETURN f.type AS funding, c.direction AS direction, count(*) AS claims
ORDER BY claims DESC`;

export function QueriesPanel({ state }: { state: State }) {
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [cypher, setCypher] = useState(EXAMPLE);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = metrics ?? state.metrics;

  const rerun = async () => {
    if (!state.key) return;
    setBusy(true);
    try {
      setMetrics(await getBenchmarks(state.key));
    } finally {
      setBusy(false);
    }
  };

  const exec = async () => {
    setErr(null);
    setResult(null);
    try {
      setResult(await runQuery(cypher, state.key));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 p-5">
      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Data model in FalkorDB</h3>
        <p className="mb-2 text-[12.5px] leading-[1.55] text-ink-2">
          One shared property graph. Papers, authors, labs and funders are merged across substances, so agents reuse what earlier runs found. Claims are
          scoped to a substance and grouped by outcome; disagreement is stored as a first-class <span className="mono text-[11.5px]">CONTRADICTS</span> edge with its reason.
        </p>
        <div className="rounded-[8px] border border-line bg-surface p-2">
          <Schema />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Multi-hop queries</h3>
          <button onClick={rerun} disabled={busy || !state.key} className="text-[11.5px] text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink disabled:opacity-40">
            {busy ? "Running…" : "Run again"}
          </button>
        </div>
        {!list ? (
          <p className="text-[12.5px] text-ink-3">Benchmarks run when a build finishes.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {list.map((m) => {
                const max = Math.max(...list.map((x) => x.p95_ms), 0.001);
                return (
                  <li key={m.id} className="rounded-[8px] border border-line bg-surface">
                    <button className="w-full p-3 text-left" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-ink">{m.title}</span>
                        <span className="mono shrink-0 rounded-[3px] border border-line-2 px-1 text-[10px] text-ink-2">{m.hops} hops</span>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{m.question}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="relative h-[6px] flex-1 rounded-full bg-surface-3">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${(m.median_ms / max) * 100}%` }} />
                          <span className="absolute top-[-2px] h-[10px] w-[2px] rounded bg-ink-3" style={{ left: `${(m.p95_ms / max) * 100}%` }} title="p95" />
                        </div>
                        <span className="mono tabular shrink-0 text-[11px] text-ink">
                          {m.median_ms.toFixed(2)} ms <span className="text-ink-3">· p95 {m.p95_ms.toFixed(2)}</span>
                        </span>
                      </div>
                      <div className="mono mt-1 text-[10.5px] text-ink-3">{m.rows} rows</div>
                    </button>
                    {open === m.id && (
                      <div className="space-y-2 border-t border-line p-3">
                        <pre className="mono scroll-thin overflow-x-auto whitespace-pre rounded-[6px] bg-surface-2 p-2 text-[10.5px] leading-relaxed text-ink-2">{m.cypher}</pre>
                        {m.sample.length > 0 && <Table columns={m.columns} rows={m.sample} />}
                        <button className="text-[11.5px] text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink" onClick={() => setCypher(m.cypher)}>
                          Open in console
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">Median and p95 over 7 runs, measured from the API (includes network round-trip to FalkorDB).</p>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Cypher console</h3>
        <p className="mb-2 text-[11.5px] text-ink-3">
          Read-only (<span className="mono">GRAPH.RO_QUERY</span>), 3 s timeout, 500-row cap. <span className="mono">$k</span> is the current substance.
        </p>
        <textarea
          value={cypher}
          onChange={(e) => setCypher(e.target.value)}
          spellCheck={false}
          rows={5}
          aria-label="Cypher query"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") exec();
          }}
          className="mono w-full resize-y rounded-[7px] border border-line-2 bg-surface p-2.5 text-[11.5px] leading-relaxed text-ink outline-none focus:border-ink-3"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="mono text-[10.5px] text-ink-3">⌘ ↵ to run</span>
          <button onClick={exec} className="rounded-[6px] bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90">
            Run query
          </button>
        </div>
        {err && (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-[7px] border border-neg bg-neg-soft/50 px-3 py-2 text-[12px] text-ink">
            <span className="mono shrink-0 text-[10px] uppercase tracking-wide text-neg-ink">blocked</span>
            {err}
          </div>
        )}
        {result && (
          <div className="mt-2 space-y-1">
            <div className="mono text-[10.5px] text-ink-3">
              {result.rows.length} rows{result.truncated ? " (truncated)" : ""} · {result.ms} ms
            </div>
            <Table columns={result.columns} rows={result.rows} />
          </div>
        )}
      </section>
    </div>
  );
}
