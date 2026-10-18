"use client";

import { CircleAlert, Play, RotateCw, SquareTerminal } from "lucide-react";
import { useRef, useState } from "react";
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
  if (v == null) return <span className="text-ink-3">null</span>;
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
      <Table className="text-[12px]">
        <TableHeader className="sticky top-0 bg-surface-2">
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c} className="code h-7 px-2 text-[12px] font-medium text-muted-foreground">
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

function N({ x, y, label, dark }: { x: number; y: number; label: string; dark?: boolean }) {
  return (
    <g>
      <rect x={x - 40} y={y - 11} width="80" height="22" rx="5" fill={dark ? "var(--ink)" : "var(--surface)"} stroke={dark ? "var(--ink)" : "var(--line-2)"} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="10.5" fill={dark ? "var(--primary-foreground)" : "var(--ink)"} fontWeight="500">
        {label}
      </text>
    </g>
  );
}

function E({ d, label, lx, ly, color = "var(--ink-4)", dash }: { d: string; label: string; lx: number; ly: number; color?: string; dash?: string }) {
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" strokeDasharray={dash} markerEnd="url(#arr)" />
      <text x={lx} y={ly} fontSize="8.5" fill="var(--ink-3)" className="tabular" textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

/** The property-graph model, drawn as a schema. */
function Schema() {
  return (
    <svg viewBox="0 0 340 260" className="w-full" role="img" aria-label="Graph schema">
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8z" fill="var(--ink-3)" />
        </marker>
      </defs>
      <E d="M60,31 L60,68" label="ASKS" lx={78} ly={52} />
      <E d="M60,91 L60,128" label="SUBJECT·OUTCOME" lx={60} ly={113} />
      <E d="M100,80 L158,80" label="CONSIDERED" lx={129} ly={74} />
      <E d="M240,74 L262,48" label="AUTHORED_BY" lx={232} ly={52} />
      <E d="M240,80 L258,80" label="AFFILIATED" lx={250} ly={96} />
      <E d="M240,86 L262,112" label="FUNDED_BY" lx={232} ly={112} />
      <E d="M200,91 L200,138" label="DESCRIBES" lx={226} ly={117} />
      <E d="M200,161 L200,203" label="FOUND" lx={218} ly={185} />
      <E d="M240,215 L268,215" label="IN_CLUSTER" lx={254} ly={208} />
      <E d="M160,210 C110,200 80,160 70,92" label="EVIDENCE_FOR {stance}" lx={100} ly={186} color="var(--pos)" />
      <E d="M162,222 C120,240 70,200 60,152" label="MEASURES" lx={86} ly={232} />
      <E d="M180,226 C170,262 230,262 220,226" label="CONTRADICTS {hypothesis}" lx={200} ly={256} color="var(--neg)" dash="5 3" />
      <E d="M180,70 C170,40 230,40 220,70" label="CITES" lx={200} ly={44} dash="2 3" />
      <N x={60} y={20} label="Question" dark />
      <N x={60} y={80} label="Hypothesis" dark />
      <N x={60} y={140} label="Concept" />
      <N x={200} y={80} label="Paper" />
      <N x={300} y={38} label="Author" />
      <N x={300} y={80} label="Lab" />
      <N x={300} y={122} label="Funder" />
      <N x={200} y={150} label="Study" />
      <N x={200} y={215} label="Finding" />
      <N x={308} y={215} label="Cluster" />
    </svg>
  );
}

const EXAMPLE = `MATCH (:Question {id:$q})-[:ASKS]->(h:Hypothesis)<-[e:EVIDENCE_FOR]-(:Finding)<-[:FOUND]-(:Study)<-[:DESCRIBES]-(p:Paper)
OPTIONAL MATCH (p)-[:FUNDED_BY]->(f:Funder)
RETURN h.statement AS hypothesis, coalesce(f.type, 'undisclosed') AS funding, e.stance AS stance, count(*) AS findings
ORDER BY hypothesis, findings DESC`;

export function QueriesPanel({ state }: { state: State }) {
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [cypher, setCypher] = useState(EXAMPLE);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const consoleRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const list = metrics ?? state.metrics;

  const rerun = async () => {
    if (!state.question?.id) return;
    setBusy(true);
    try {
      setMetrics(await getBenchmarks(state.question?.id));
    } finally {
      setBusy(false);
    }
  };

  const exec = async (query = cypher) => {
    setErr(null);
    setResult(null);
    try {
      setResult(await runQuery(query, state.question?.id));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  /** Load a benchmark query into the console, run it, and bring the console into view. */
  const openInConsole = (query: string) => {
    setCypher(query);
    exec(query);
    consoleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    editorRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-6 p-5">
      <section>
        <SectionLabel className="mb-1">Data model in FalkorDB</SectionLabel>
        <p className="mb-2 text-[12.5px] leading-[1.55] text-ink-2">
          One shared property graph. Papers, studies and findings are merged across questions, so agents reuse what earlier runs found. A finding&apos;s
          stance lives on its <span className="code text-[12.5px]">EVIDENCE_FOR</span> edge, so the same finding can support one hypothesis and be irrelevant to
          another; disagreement is a <span className="code text-[12.5px]">CONTRADICTS</span> edge scoped to a hypothesis.
        </p>
        <Card size="sm" className="px-2 shadow-none">
          <Schema />
        </Card>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Multi-hop queries</SectionLabel>
          <Button variant="ghost" size="xs" onClick={rerun} disabled={busy || !state.question?.id}>
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
                          <Badge variant="outline" className="h-4 shrink-0 rounded-sm px-1 text-[12px] font-normal">
                            {m.hops} hops
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{m.question}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="relative h-[6px] flex-1 rounded-full bg-muted">
                            <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(m.median_ms / max) * 100}%` }} />
                            <span className="absolute top-[-2px] h-[10px] w-[2px] rounded bg-ink-3" style={{ left: `${(m.p95_ms / max) * 100}%` }} title="p95" />
                          </div>
                          <span className="tabular shrink-0 text-[12px] text-foreground">
                            {m.median_ms.toFixed(2)} ms <span className="text-muted-foreground">· p95 {m.p95_ms.toFixed(2)}</span>
                          </span>
                        </div>
                        <div className="mt-1 text-[12px] text-muted-foreground">{m.rows} rows</div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-2 border-t p-3">
                          <pre className="code scroll-thin overflow-x-auto whitespace-pre rounded-md bg-muted/60 p-2 text-[12px] leading-relaxed text-ink-2">{m.cypher}</pre>
                          {m.sample.length > 0 && <ResultTable columns={m.columns} rows={m.sample} />}
                          <Button variant="outline" size="xs" onClick={() => openInConsole(m.cypher)}>
                            <SquareTerminal />
                            Run in console
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Card>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">Median and p95 over 7 runs, measured from the API (includes the round-trip to FalkorDB).</p>
          </>
        )}
      </section>

      <section ref={consoleRef} className="scroll-mt-4">
        <SectionLabel className="mb-1">Cypher console</SectionLabel>
        <p className="mb-2 text-[12.5px] text-muted-foreground">
          Read-only (<span className="code">GRAPH.RO_QUERY</span>), 3 s timeout, 500-row cap. <span className="code">$q</span> is the current question.
        </p>
        <Textarea
          ref={editorRef}
          value={cypher}
          onChange={(e) => setCypher(e.target.value)}
          spellCheck={false}
          rows={5}
          aria-label="Cypher query"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") exec();
          }}
          className="code resize-y bg-card text-[12.5px] leading-relaxed"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[12px] text-muted-foreground">⌘ ↵ to run</span>
          <Button size="sm" onClick={() => exec()}>
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
            <div className="text-[12px] text-muted-foreground">
              {result.rows.length} rows{result.truncated ? " (truncated)" : ""} in {result.ms} ms
            </div>
            <ResultTable columns={result.columns} rows={result.rows} />
          </div>
        )}
      </section>
    </div>
  );
}
