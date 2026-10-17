"use client";

import { CircleAlert, Play, RotateCw } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getBenchmarks, runQuery, type QueryResult } from "@/lib/api";
import type { State } from "@/lib/store";
import type { Metric } from "@/lib/types";
import { SectionLabel } from "../Tip";

function Cell({ v }: { v: unknown }) {
  if (v == null) return <span className="text-ink-4">null</span>;
  if (Array.isArray(v)) return <span>{v.map((x) => (typeof x === "object" ? "{…}" : String(x))).join(", ")}</span>;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return <span title={JSON.stringify(o).slice(0, 400)}>{String(o.label ?? o.name ?? o.text ?? o.title ?? `(${(o.labels as string[])?.join(":") ?? "obj"})`)}</span>;
  }
  return <span>{String(v)}</span>;
}

function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  return (
    <div className="scroll-thin max-h-[220px] overflow-auto rounded-md border bg-card">
      <Table className="text-[11px]">
        <TableHeader className="sticky top-0 bg-surface-2">
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c} className="mono h-7 px-2 text-[11px] font-medium text-muted-foreground">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((v, j) => (
                <TableCell key={j} className="max-w-[180px] truncate px-2 py-1 align-top text-ink-2">
                  <Cell v={v} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
        <SectionLabel className="mb-1">Data model in FalkorDB</SectionLabel>
        <p className="mb-2 text-[12.5px] leading-[1.55] text-ink-2">
          One shared property graph. Papers, authors, labs and funders are merged across substances, so agents reuse what earlier runs found. Claims are
          scoped to a substance and grouped by outcome; disagreement is stored as a first-class <span className="mono text-[11.5px]">CONTRADICTS</span> edge with its reason.
        </p>
        <Card size="sm" className="px-2 shadow-none">
          <Schema />
        </Card>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Multi-hop queries</SectionLabel>
          <Button variant="ghost" size="xs" onClick={rerun} disabled={busy || !state.key}>
            <RotateCw className={busy ? "animate-spin" : ""} />
            {busy ? "Running" : "Run again"}
          </Button>
        </div>
        {!list ? (
          <p className="text-[12.5px] text-muted-foreground">Benchmarks run when a build finishes.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {list.map((m) => {
                const max = Math.max(...list.map((x) => x.p95_ms), 0.001);
                return (
                  <li key={m.id}>
                    <Collapsible open={open === m.id} onOpenChange={(o) => setOpen(o ? m.id : null)}>
                    <Card size="sm" className="gap-0 py-0 shadow-none">
                      <CollapsibleTrigger className="w-full rounded-xl p-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/60">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-foreground">{m.title}</span>
                          <Badge variant="outline" className="mono h-4 shrink-0 rounded-sm px-1 text-[10px] font-normal">
                            {m.hops} hops
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{m.question}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="relative h-[6px] flex-1 rounded-full bg-muted">
                            <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(m.median_ms / max) * 100}%` }} />
                            <span className="absolute top-[-2px] h-[10px] w-[2px] rounded bg-ink-3" style={{ left: `${(m.p95_ms / max) * 100}%` }} title="p95" />
                          </div>
                          <span className="mono tabular shrink-0 text-[11px] text-foreground">
                            {m.median_ms.toFixed(2)} ms <span className="text-muted-foreground">· p95 {m.p95_ms.toFixed(2)}</span>
                          </span>
                        </div>
                        <div className="mono mt-1 text-[10.5px] text-muted-foreground">{m.rows} rows</div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-2 border-t p-3">
                          <pre className="mono scroll-thin overflow-x-auto whitespace-pre rounded-md bg-muted/60 p-2 text-[10.5px] leading-relaxed text-ink-2">{m.cypher}</pre>
                          {m.sample.length > 0 && <ResultTable columns={m.columns} rows={m.sample} />}
                          <Button variant="link" size="xs" className="h-auto px-0" onClick={() => setCypher(m.cypher)}>
                            Open in console
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Card>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Median and p95 over 7 runs, measured from the API (includes the round-trip to FalkorDB).</p>
          </>
        )}
      </section>

      <section>
        <SectionLabel className="mb-1">Cypher console</SectionLabel>
        <p className="mb-2 text-[11.5px] text-muted-foreground">
          Read-only (<span className="mono">GRAPH.RO_QUERY</span>), 3 s timeout, 500-row cap. <span className="mono">$k</span> is the current substance.
        </p>
        <Textarea
          value={cypher}
          onChange={(e) => setCypher(e.target.value)}
          spellCheck={false}
          rows={5}
          aria-label="Cypher query"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") exec();
          }}
          className="mono resize-y bg-card text-[11.5px] leading-relaxed"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="mono text-[10.5px] text-muted-foreground">⌘ ↵ to run</span>
          <Button size="sm" onClick={exec}>
            <Play />
            Run query
          </Button>
        </div>
        {err && (
          <Alert variant="destructive" className="mt-2 border-destructive/40 bg-neg-soft/40">
            <CircleAlert />
            <AlertDescription className="text-[12px] text-foreground">{err}</AlertDescription>
          </Alert>
        )}
        {result && (
          <div className="mt-2 space-y-1">
            <div className="mono text-[10.5px] text-muted-foreground">
              {result.rows.length} rows{result.truncated ? " (truncated)" : ""} · {result.ms} ms
            </div>
            <ResultTable columns={result.columns} rows={result.rows} />
          </div>
        )}
      </section>
    </div>
  );
}
