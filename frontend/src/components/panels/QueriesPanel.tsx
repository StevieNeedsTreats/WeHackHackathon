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

const NW = 88;
const NH = 26;

function N({ x, y, label, dark }: { x: number; y: number; label: string; dark?: boolean }) {
  return (
    <g>
      <rect x={x - NW / 2} y={y - NH / 2} width={NW} height={NH} rx="6" fill={dark ? "var(--ink)" : "var(--surface)"} stroke={dark ? "var(--ink)" : "var(--line-2)"} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fill={dark ? "var(--primary-foreground)" : "var(--ink)"} fontWeight="500">
        {label}
      </text>
    </g>
  );
}

type Tone = "plain" | "pos" | "neg";
const STROKE: Record<Tone, string> = { plain: "var(--ink-4)", pos: "var(--pos)", neg: "var(--neg)" };

/** A relationship: the line, its arrowhead, and its type name on a halo so lines never cut through it. */
function E({ d, tone = "plain", dash }: { d: string; tone?: Tone; dash?: string }) {
  return <path d={d} fill="none" stroke={STROKE[tone]} strokeWidth="1.25" strokeDasharray={dash} markerEnd={`url(#arr-${tone})`} />;
}

function L({ x, y, children, anchor = "middle", tone = "plain", rotate }: { x: number; y: number; children: React.ReactNode; anchor?: "start" | "middle" | "end"; tone?: Tone; rotate?: boolean }) {
  return (
    <text
      x={x}
      y={y}
      fontSize="8.5"
      textAnchor={anchor}
      fill={tone === "plain" ? "var(--ink-3)" : tone === "pos" ? "var(--pos-ink)" : "var(--neg-ink)"}
      stroke="var(--card)"
      strokeWidth="3"
      paintOrder="stroke"
      transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}
      style={{ fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}
    >
      {children}
    </text>
  );
}

/**
 * The property-graph model, drawn as a schema on three columns: the question side, the paper chain,
 * and what hangs off a paper or finding. Each relationship's name sits beside its line, never on a
 * neighbour's.
 */
function Schema() {
  // Column centres and the edges of their boxes.
  const A = 52;
  const B = 206;
  const C = 360;
  const r = (x: number) => x + NW / 2;
  const l = (x: number) => x - NW / 2;
  const t = (y: number) => y - NH / 2;
  const b = (y: number) => y + NH / 2;
  const Y = { question: 28, hyp: 110, author: 58, lab: 110, funder: 162, study: 190, finding: 270 };
  return (
    <svg viewBox="0 0 412 334" className="w-full" role="img" aria-label="Graph schema: how questions, hypotheses, papers, studies and findings connect">
      <defs>
        {(Object.keys(STROKE) as Tone[]).map((k) => (
          <marker key={k} id={`arr-${k}`} viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0.5 L8,4 L0,7.5z" fill={k === "plain" ? "var(--ink-3)" : STROKE[k]} />
          </marker>
        ))}
      </defs>

      {/* question side */}
      <E d={`M${A},${b(Y.question)} V${t(Y.hyp)}`} />
      <L x={A + 7} y={(b(Y.question) + t(Y.hyp)) / 2 + 3} anchor="start">ASKS</L>
      <E d={`M${A},${b(Y.hyp)} V${t(Y.finding)}`} />
      <L x={A - 6} y={(b(Y.hyp) + t(Y.finding)) / 2} rotate>SUBJECT | OUTCOME</L>

      {/* hypothesis to paper, and a paper's own links */}
      <E d={`M${r(A)},${Y.hyp} H${l(B)}`} />
      <L x={(r(A) + l(B)) / 2} y={Y.hyp - 6}>CONSIDERED</L>
      <E d={`M${B - 14},${t(Y.hyp)} C${B - 22},${t(Y.hyp) - 26} ${B + 22},${t(Y.hyp) - 26} ${B + 14},${t(Y.hyp)}`} dash="2 3" />
      <L x={B} y={t(Y.hyp) - 24}>CITES</L>
      <E d={`M${r(B)},${Y.hyp - 6} C${r(B) + 30},${Y.hyp - 6} ${l(C) - 30},${Y.author} ${l(C)},${Y.author}`} />
      <L x={C} y={t(Y.author) - 5}>AUTHORED_BY</L>
      <E d={`M${r(B)},${Y.lab} H${l(C)}`} />
      <L x={C} y={t(Y.lab) - 5}>AFFILIATED</L>
      <E d={`M${r(B)},${Y.hyp + 6} C${r(B) + 30},${Y.hyp + 6} ${l(C) - 30},${Y.funder} ${l(C)},${Y.funder}`} />
      <L x={C} y={t(Y.funder) - 5}>FUNDED_BY</L>

      {/* paper to finding */}
      <E d={`M${B},${b(Y.hyp)} V${t(Y.study)}`} />
      <L x={B + 7} y={(b(Y.hyp) + t(Y.study)) / 2 + 3} anchor="start">DESCRIBES</L>
      <E d={`M${B},${b(Y.study)} V${t(Y.finding)}`} />
      <L x={B + 7} y={(b(Y.study) + t(Y.finding)) / 2 + 3} anchor="start">FOUND</L>

      {/* what a finding points at */}
      <E d={`M${l(B)},${Y.finding} H${r(A)}`} />
      <L x={(r(A) + l(B)) / 2} y={Y.finding - 6}>MEASURES</L>
      <E d={`M${r(B)},${Y.finding} H${l(C)}`} />
      <L x={(r(B) + l(C)) / 2} y={Y.finding - 6}>IN_CLUSTER</L>
      <E d={`M${l(B) + 10},${t(Y.finding)} C${l(B) - 20},${Y.study + 10} ${r(A) + 4},${Y.hyp + 40} ${r(A) - 14},${b(Y.hyp)}`} tone="pos" />
      <L x={r(A) + 50} y={Y.study + 26} anchor="end" tone="pos">EVIDENCE_FOR</L>
      <L x={r(A) + 50} y={Y.study + 37} anchor="end" tone="pos">{"{stance}"}</L>
      <E d={`M${B - 14},${b(Y.finding)} C${B - 22},${b(Y.finding) + 26} ${B + 22},${b(Y.finding) + 26} ${B + 14},${b(Y.finding)}`} tone="neg" dash="4 3" />
      <L x={B} y={b(Y.finding) + 34} tone="neg">{"CONTRADICTS {hypothesis}"}</L>

      <N x={A} y={Y.question} label="Question" dark />
      <N x={A} y={Y.hyp} label="Hypothesis" dark />
      <N x={A} y={Y.finding} label="Concept" />
      <N x={B} y={Y.hyp} label="Paper" />
      <N x={C} y={Y.author} label="Author" />
      <N x={C} y={Y.lab} label="Lab" />
      <N x={C} y={Y.funder} label="Funder" />
      <N x={B} y={Y.study} label="Study" />
      <N x={B} y={Y.finding} label="Finding" />
      <N x={C} y={Y.finding} label="Cluster" />
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
