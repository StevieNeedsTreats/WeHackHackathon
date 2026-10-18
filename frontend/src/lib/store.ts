"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { attachUrl, cachedQuestion, loadQuestion, stopRun, streamUrl, type Edits, type Snapshot } from "./api";
import { authFetch } from "./auth";
import type {
  Cluster,
  Contradiction,
  DomainInfo,
  Finding,
  Flag,
  Guardrail,
  Hypothesis,
  Metric,
  Paper,
  Question,
  Stats,
  Study,
  Usage,
  Verdict,
} from "./types";

export type AgentStatus = "queued" | "running" | "done" | "error";

export interface AgentState {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  detail: string;
  done?: number | null;
  total?: number | null;
  ms: number;
  hypothesis?: string | null;
}

export const AGENT_ORDER: Pick<AgentState, "id" | "name" | "role">[] = [
  { id: "orchestrator", name: "Graph Manager", role: "Plans the run, dedupes papers, decides what to do next" },
  { id: "intake", name: "Intake", role: "Turns the question into testable hypotheses" },
  { id: "discovery", name: "Search / Discovery", role: "Searches each source for supporting and refuting studies" },
  { id: "extractor", name: "Structured Extractor", role: "Studies, participants, methods and findings per paper" },
  { id: "credibility", name: "Credibility Enricher", role: "0–100 score with itemised reasons" },
  { id: "stance", name: "Stance & Grouper", role: "Supports / refutes per hypothesis, grouped by context" },
  { id: "contradictions", name: "Contradiction Mapper", role: "Real conflicts vs differences in population or dose" },
  { id: "verdict", name: "Verdict", role: "Graded verdict, insights and gaps" },
];

export interface Step {
  t: number;
  agent: string;
  hypothesis?: string | null;
  kind: "status" | "tool" | "search" | "note";
  text: string;
}

export type Status = "idle" | "streaming" | "done" | "error" | "refused";

export interface State {
  status: Status;
  mode: "live" | "demo" | "snapshot";
  engine: string;
  question: Question | null;
  domain: DomainInfo | null;
  notice: string | null;
  disclaimer: string | null;
  hyps: Record<string, Hypothesis>;
  hypOrder: string[];
  papers: Record<string, Paper>;
  paperOrder: string[];
  studies: Record<string, Study>;
  findings: Record<string, Finding>;
  clusters: Record<string, Cluster>;
  contradictions: Record<string, Contradiction[]>;
  verdicts: Record<string, Verdict>;
  cites: [string, string][];
  agents: Record<string, AgentState>;
  steps: Step[];
  usage: Record<string, Usage>;
  metrics: Metric[] | null;
  stats: Stats | null;
  flags: Flag[];
  guard: Guardrail | null;
  error: string | null;
  version: number;
}

const freshAgents = () =>
  Object.fromEntries(AGENT_ORDER.map((a) => [a.id, { ...a, status: "queued", detail: "", ms: 0 } as AgentState]));

export const initial: State = {
  status: "idle",
  mode: "live",
  engine: "",
  question: null,
  domain: null,
  notice: null,
  disclaimer: null,
  hyps: {},
  hypOrder: [],
  papers: {},
  paperOrder: [],
  studies: {},
  findings: {},
  clusters: {},
  contradictions: {},
  verdicts: {},
  cites: [],
  agents: freshAgents(),
  steps: [],
  usage: {},
  metrics: null,
  stats: null,
  flags: [],
  guard: null,
  error: null,
  version: 0,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE payloads are untyped JSON, shaped per event below
export type Ev = { event: string; data: any };
type Action =
  | { type: "start"; mode: State["mode"] }
  | { type: "events"; events: Ev[] }
  | { type: "snapshot"; snap: Snapshot }
  | { type: "error"; message: string }
  | { type: "reset" };

const MAX_STEPS = 120;
const addStep = (s: State, step: Step): State => ({ ...s, steps: [...s.steps.slice(-(MAX_STEPS - 1)), step] });

function setHyps(s: State, hs: Hypothesis[]): State {
  const hyps = { ...s.hyps };
  const order = [...s.hypOrder];
  const seen = new Set(order);
  for (const h of hs) {
    hyps[h.key] = { ...(hyps[h.key] ?? {}), ...h };
    if (!seen.has(h.key)) {
      seen.add(h.key);
      order.push(h.key);
    }
  }
  return { ...s, hyps, hypOrder: order };
}

function normPaper(p: Snapshot["papers"][number] | Paper): Paper {
  const x = p as Snapshot["papers"][number];
  return { ...x, reasons: x.reasons ?? x.cred_reasons, n: x.n ?? x.sample_size ?? null, authors: x.authors ?? [], funders: x.funders ?? [], labs: x.labs ?? [], considered: x.considered ?? {} };
}

function applyEvent(s: State, { event, data }: Ev): State {
  const { _t: t, ...d } = data ?? {};
  switch (event) {
    case "guardrail":
      return d.ok ? { ...s, guard: d } : { ...s, guard: d, status: "refused" };
    case "interpretation":
      return setHyps({ ...s, question: d.question, notice: d.notice, disclaimer: d.disclaimer, domain: d.domain }, d.question.hypotheses);
    case "run":
      return { ...s, engine: d.engine, domain: d.domain ?? s.domain };
    case "agent": {
      const prev = s.agents[d.agent];
      if (!prev) return s;
      const agents = { ...s.agents, [d.agent]: { ...prev, status: d.status, detail: d.detail, done: d.done, total: d.total, ms: d.ms, hypothesis: d.hypothesis } };
      const n = { ...s, agents };
      return d.detail && d.detail !== prev.detail ? addStep(n, { t, agent: d.agent, hypothesis: d.hypothesis, kind: "status", text: d.detail }) : n;
    }
    case "agent_step": {
      const text =
        d.kind === "search"
          ? `${d.tool}: ${d.args}`
          : d.kind === "note"
            ? String(d.args ?? d.text ?? "")
            : `${d.tool}(${typeof d.args === "string" ? d.args : JSON.stringify(d.args ?? {}).slice(0, 90)})`;
      return addStep(s, { t, agent: d.agent, hypothesis: d.hypothesis, kind: d.kind, text });
    }
    case "usage": {
      const { agent, ...u } = d;
      return { ...s, usage: { ...s.usage, [agent]: u } };
    }
    case "hypothesis":
      return setHyps(s, [d as Hypothesis]);
    case "paper": {
      const p = normPaper(d.paper);
      const prev = s.papers[p.id];
      return {
        ...s,
        papers: { ...s.papers, [p.id]: { ...(prev ?? {}), ...p, considered: { ...(prev?.considered ?? {}), ...p.considered } } },
        paperOrder: prev ? s.paperOrder : [...s.paperOrder, p.id],
      };
    }
    case "cites":
      return { ...s, cites: [...s.cites, ...(d.pairs as [string, string][]).filter(([a, b]) => !s.cites.some(([x, y]) => x === a && y === b))] };
    case "merge": {
      const papers = { ...s.papers };
      const drop = papers[d.drop];
      delete papers[d.drop];
      if (drop && papers[d.keep]) papers[d.keep] = { ...papers[d.keep], considered: { ...drop.considered, ...papers[d.keep].considered } };
      return { ...s, papers, paperOrder: s.paperOrder.filter((id) => id !== d.drop) };
    }
    case "extraction": {
      const studies = { ...s.studies };
      for (const st of d.studies as Study[]) studies[st.id] = st;
      const findings = { ...s.findings };
      for (const f of d.findings as Finding[]) findings[f.id] = { ...f, evidence: s.findings[f.id]?.evidence ?? {} };
      const p = s.papers[d.paper_id];
      const papers = p ? { ...s.papers, [d.paper_id]: { ...p, design: d.design ?? p.design, n: d.n ?? p.n } } : s.papers;
      return { ...s, studies, findings, papers };
    }
    case "credibility": {
      const p = s.papers[d.paper_id];
      if (!p) return s;
      return { ...s, papers: { ...s.papers, [d.paper_id]: { ...p, credibility: d.score, reasons: d.reasons, flags: d.flags } } };
    }
    case "flag":
      return { ...s, flags: [...s.flags, d as Flag] };
    case "stances": {
      const hk: string = d.hypothesis;
      const findings: Record<string, Finding> = {};
      for (const [id, f] of Object.entries(s.findings)) {
        const { [hk]: _drop, ...rest } = f.evidence;
        findings[id] = { ...f, evidence: rest };
      }
      for (const e of d.evidence) {
        const f = findings[e.finding_id];
        if (f) findings[e.finding_id] = { ...f, evidence: { ...f.evidence, [hk]: { stance: e.stance, weight: e.weight, rationale: e.rationale, cluster: e.cluster } } };
      }
      const clusters = Object.fromEntries(Object.entries(s.clusters).filter(([, c]) => c.hypothesis !== hk));
      for (const c of d.clusters as Cluster[]) clusters[c.id] = c;
      return { ...s, findings, clusters };
    }
    case "contradictions":
      return { ...s, contradictions: { ...s.contradictions, [d.hypothesis]: (d.items as Omit<Contradiction, "hypothesis">[]).map((c) => ({ ...c, hypothesis: d.hypothesis })) } };
    case "verdict":
      return { ...s, verdicts: { ...s.verdicts, [d.hypothesis]: d as Verdict } };
    case "metrics":
      return { ...s, metrics: d.items };
    case "done":
      return { ...s, stats: d as Stats, status: "done" };
    case "error":
      return { ...s, status: "error", error: d.message };
    default:
      return s;
  }
}

function fromSnapshot(s: State, snap: Snapshot): State {
  const papers = Object.fromEntries(snap.papers.map((p) => [p.id, normPaper(p)]));
  const contradictions: Record<string, Contradiction[]> = {};
  for (const c of snap.contradictions) (contradictions[c.hypothesis] ??= []).push(c);
  const verdicts = Object.fromEntries(Object.entries(snap.verdicts).filter(([, v]) => v)) as Record<string, Verdict>;
  const done = (status: AgentState) => ({ ...status, status: "done" as const, detail: status.detail || "Loaded from FalkorDB" });
  return {
    ...initial,
    version: s.version + 1,
    status: "done",
    mode: "snapshot",
    engine: snap.stats?.engine ?? "",
    question: { ...snap.question, hypotheses: snap.hypotheses },
    disclaimer: snap.disclaimer,
    hyps: Object.fromEntries(snap.hypotheses.map((h) => [h.key, { ...h, stage: "done" as const }])),
    hypOrder: snap.hypotheses.map((h) => h.key),
    papers,
    paperOrder: [...snap.papers].sort((a, b) => (b.credibility ?? 0) - (a.credibility ?? 0)).map((p) => p.id),
    studies: Object.fromEntries(snap.studies.map((x) => [x.id, x])),
    findings: Object.fromEntries(snap.findings.map((f) => [f.id, f])),
    clusters: Object.fromEntries(snap.clusters.map((c) => [c.id, c])),
    contradictions,
    verdicts,
    cites: snap.cites,
    agents: Object.fromEntries(Object.values(freshAgents()).map((a) => [a.id, done(a)])),
    usage: snap.stats?.usage?.agents ?? {},
    metrics: snap.metrics,
    stats: snap.stats,
    flags: snap.flags ?? [],
  };
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "reset":
      return { ...initial, agents: freshAgents(), version: s.version + 1 };
    case "start":
      return { ...initial, agents: freshAgents(), status: "streaming", mode: a.mode, version: s.version + 1 };
    case "events": {
      let n = s;
      for (const e of a.events) n = applyEvent(n, e);
      return n;
    }
    case "snapshot":
      return fromSnapshot(s, a.snap);
    case "error":
      return { ...s, status: "error", error: a.message };
  }
}

/** Parse a text/event-stream body incrementally. */
export async function* sse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<Ev> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        yield { event, data: JSON.parse(data.join("\n")) };
      } catch {}
    }
  }
}

export function useResearch() {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<Ev[]>([]);
  const raf = useRef<number | null>(null);

  // Events are buffered and flushed once per animation frame so a burst of
  // events costs one render, not hundreds.
  const push = useCallback((e: Ev) => {
    pending.current.push(e);
    if (raf.current == null) {
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        const events = pending.current;
        pending.current = [];
        dispatch({ type: "events", events });
      });
    }
  }, []);

  /** Stop watching. The run itself keeps going on the server. */
  const detach = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);

  const follow = useCallback(
    async (url: string, mode: "live" | "demo") => {
      detach();
      const ctrl = new AbortController();
      abort.current = ctrl;
      dispatch({ type: "start", mode });
      try {
        const r = await authFetch(url, { signal: ctrl.signal, headers: { accept: "text/event-stream" } });
        if (!r.ok || !r.body) {
          let msg = `Request failed (${r.status})`;
          try {
            msg = (await r.json()).detail ?? msg;
          } catch {}
          dispatch({ type: "error", message: msg });
          return;
        }
        for await (const ev of sse(r.body, ctrl.signal)) {
          if (ev.event === "end") break;
          push(ev);
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") dispatch({ type: "error", message: "Lost connection to the API. Is the backend running on :8100?" });
      }
    },
    [push, detach],
  );

  const run = useCallback((q: string, mode: "live" | "demo", edits?: Edits) => follow(streamUrl(q, mode, edits), mode), [follow]);

  /** Load a question: a finished one from FalkorDB, a running one by attaching to its live run. */
  // Stale-while-revalidate: a cached snapshot renders immediately, the fresh one replaces it only
  // if it changed, and a slow response never overwrites a question opened after it.
  const loadSeq = useRef(0);
  const load = useCallback(
    async (id: string) => {
      detach();
      const seq = ++loadSeq.current;
      const hit = cachedQuestion(id);
      if (hit) dispatch({ type: "snapshot", snap: hit });
      try {
        const { snap, changed } = await loadQuestion(id);
        if (seq !== loadSeq.current) return;
        if (snap.running) follow(attachUrl(id), id.startsWith("demo-") ? "demo" : "live");
        else if (!hit || changed) dispatch({ type: "snapshot", snap });
      } catch (e) {
        if (seq !== loadSeq.current) return;
        dispatch({ type: "error", message: (e as Error)?.message ?? "Could not load question" });
      }
    },
    [detach, follow],
  );

  /** Actually stop the run on the server (not just this view of it). */
  const stopRunning = useCallback(async () => {
    const id = stateRef.current.question?.id;
    if (!id) return detach();
    try {
      await stopRun(id);
    } catch {
      detach();
    }
  }, [detach]);

  useEffect(() => () => detach(), [detach]);

  /**
   * Apply events from outside the main stream (papers added to the open question) on top of what
   * is shown. Dropped when another question is open by then; usage events belong to the original run.
   */
  const absorb = useCallback(
    (qid: string, ev: Ev) => {
      if (stateRef.current.question?.id === qid && ev.event !== "usage") push(ev);
    },
    [push],
  );

  return { state, run, load, detach, absorb, stop: stopRunning, reset: () => dispatch({ type: "reset" }) };
}

// ---------------------------------------------------------------- selectors

export interface Row {
  finding: Finding;
  paper: Paper;
  study?: Study;
  stance: Finding["evidence"][string];
}

/** Findings judged relevant to one hypothesis, strongest first. */
export function evidenceFor(s: State, key: string): Row[] {
  const rows: Row[] = [];
  for (const f of Object.values(s.findings)) {
    const e = f.evidence[key];
    const paper = s.papers[f.paper_id];
    if (e && paper) rows.push({ finding: f, paper, study: s.studies[f.study_id], stance: e });
  }
  return rows.sort((a, b) => b.stance.weight - a.stance.weight);
}

/** Papers considered for a hypothesis. */
export function papersFor(s: State, key: string): Paper[] {
  return s.paperOrder.map((id) => s.papers[id]).filter((p) => p && p.considered[key]);
}

/** The specific study difference behind an explained contradiction; null when the model only repeated the reason. */
export function explanation(c: Contradiction): string | null {
  const e = c.explained_by?.trim();
  return e && e.toLowerCase() !== c.reason.toLowerCase() ? e : null;
}

/** Live balance from stances when no verdict has landed yet. */
export function balance(s: State, key: string): { support: number; refute: number; mixed: number; total: number } {
  const v = s.verdicts[key];
  if (v) return { support: v.support, refute: v.refute, mixed: v.mixed, total: v.findings };
  const h = s.hyps[key];
  if (h?.share_support != null && !Object.values(s.findings).some((f) => f.evidence[key]))
    return { support: h.share_support ?? 0, refute: h.share_refute ?? 0, mixed: h.share_mixed ?? 0, total: h.papers ?? 0 };
  const w = { supports: 0, refutes: 0, mixed: 0 };
  let n = 0;
  for (const f of Object.values(s.findings)) {
    const e = f.evidence[key];
    if (!e) continue;
    w[e.stance] += e.weight;
    n++;
  }
  const t = w.supports + w.refutes + w.mixed || 1;
  return { support: w.supports / t, refute: w.refutes / t, mixed: w.mixed / t, total: n };
}
