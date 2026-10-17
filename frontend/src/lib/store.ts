"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { getSnapshot, streamUrl, type Snapshot } from "./api";
import type { AgentState, Flag, GEdge, GNode, Guardrail, Insights, Metric, Stats } from "./types";

export const AGENT_ORDER: Omit<AgentState, "status" | "detail" | "ms">[] = [
  { id: "discovery", name: "Search / Discovery", role: "Papers, trials & reviews from Europe PMC; citations from OpenAlex" },
  { id: "extractor", name: "Structured Extractor", role: "Trials, participants, methods, +/~/− claims" },
  { id: "credibility", name: "Credibility Enricher", role: "0–100 score with reasons, metadata only" },
  { id: "grouper", name: "Claim Grouper", role: "Group claims by outcome" },
  { id: "contradictions", name: "Contradiction Mapper", role: "Direction & magnitude conflicts" },
  { id: "insights", name: "Insights", role: "Credibility-weighted consensus" },
  { id: "orchestrator", name: "Graph Manager", role: "Coordinates agents, benchmarks queries" },
];

export type Status = "idle" | "streaming" | "done" | "error" | "refused";

export interface State {
  status: Status;
  substance: string;
  key: string;
  mode: "live" | "demo" | "snapshot";
  engine: string;
  nodes: Record<string, GNode>;
  order: string[]; // arrival order, used for entry animation
  edges: Record<string, GEdge>;
  agents: Record<string, AgentState>;
  insights: Insights | null;
  narrative: string;
  metrics: Metric[] | null;
  stats: Stats | null;
  flags: Flag[];
  guard: Guardrail | null;
  error: string | null;
  log: { t: number; agent: string; detail: string }[];
  version: number;
}

const freshAgents = () =>
  Object.fromEntries(AGENT_ORDER.map((a) => [a.id, { ...a, status: "queued", detail: "", ms: 0 } as AgentState]));

export const initial: State = {
  status: "idle",
  substance: "",
  key: "",
  mode: "live",
  engine: "rules",
  nodes: {},
  order: [],
  edges: {},
  agents: freshAgents(),
  insights: null,
  narrative: "",
  metrics: null,
  stats: null,
  flags: [],
  guard: null,
  error: null,
  log: [],
  version: 0,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE payloads are untyped JSON, shaped per event below
type Ev = { event: string; data: any };
type Action =
  | { type: "start"; substance: string; mode: State["mode"] }
  | { type: "events"; events: Ev[] }
  | { type: "snapshot"; snap: Snapshot; nodes: GNode[]; edges: GEdge[]; final: boolean }
  | { type: "error"; message: string }
  | { type: "reset" };

function applyEvent(s: State, { event, data }: Ev): State {
  switch (event) {
    case "guardrail":
      return data.ok ? { ...s, guard: data } : { ...s, guard: data, status: "refused" };
    case "run":
      return { ...s, key: data.key, substance: data.substance, engine: data.engine };
    case "agent": {
      const prev = s.agents[data.agent];
      if (!prev) return s;
      const log = data.detail && data.detail !== prev.detail ? [...s.log.slice(-40), { t: data._t, agent: data.agent, detail: data.detail }] : s.log;
      return { ...s, log, agents: { ...s.agents, [data.agent]: { ...prev, status: data.status, detail: data.detail, done: data.done, total: data.total, ms: data.ms } } };
    }
    case "node":
    case "update": {
      const { _t, ...n } = data;
      const prev = s.nodes[n.id];
      return {
        ...s,
        nodes: { ...s.nodes, [n.id]: { ...(prev ?? {}), ...n } },
        order: prev ? s.order : [...s.order, n.id],
      };
    }
    case "edge": {
      const { _t, ...e } = data;
      return { ...s, edges: { ...s.edges, [e.id]: e } };
    }
    case "flag": {
      const { _t, ...f } = data;
      return { ...s, flags: [...s.flags, f] };
    }
    case "insights": {
      const { _t, ...ins } = data;
      return { ...s, insights: ins };
    }
    case "narrative":
      return { ...s, narrative: s.narrative + data.delta };
    case "metrics":
      return { ...s, metrics: data.items };
    case "done": {
      const { _t, ...stats } = data;
      return { ...s, stats, status: "done" };
    }
    case "error":
      return { ...s, status: "error", error: data.message };
    default:
      return s;
  }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "reset":
      return { ...initial, agents: freshAgents(), version: s.version + 1 };
    case "start":
      return { ...initial, agents: freshAgents(), status: "streaming", substance: a.substance, mode: a.mode, version: s.version + 1 };
    case "events": {
      let n = s;
      for (const e of a.events) n = applyEvent(n, e);
      return n;
    }
    case "snapshot": {
      const nodes = Object.fromEntries(a.nodes.map((n) => [n.id, n]));
      const edges = Object.fromEntries(a.edges.map((e) => [e.id, e]));
      const done = a.final;
      return {
        ...s,
        nodes,
        edges,
        order: a.nodes.map((n) => n.id),
        key: a.snap.key,
        substance: a.snap.name,
        mode: "snapshot",
        engine: a.snap.stats?.engine ?? "rules",
        insights: done ? a.snap.insights : null,
        narrative: done ? a.snap.insights?.narrative ?? "" : "",
        metrics: done ? a.snap.metrics : null,
        stats: done ? a.snap.stats : null,
        flags: a.snap.flags ?? [],
        status: done ? "done" : "streaming",
        agents: done
          ? Object.fromEntries(Object.values(s.agents).map((ag) => [ag.id, { ...ag, status: "done" as const, detail: ag.detail || "Loaded from FalkorDB" }]))
          : s.agents,
      };
    }
    case "error":
      return { ...s, status: "error", error: a.message };
  }
}

/** Parse a text/event-stream body incrementally. */
async function* sse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<Ev> {
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

const KIND_ORDER = ["substance", "paper", "author", "lab", "funder", "outcome", "claim"];
const EDGE_ORDER = ["STUDIED_IN", "AUTHORED_BY", "FROM_LAB", "FUNDED_BY", "CITES", "REPORTS", "ABOUT", "SUPPORTS", "CONTRADICTS"];

export function useResearch() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<Ev[]>([]);
  const raf = useRef<number | null>(null);

  // Events are buffered and flushed once per animation frame so a burst of
  // hundreds of graph events costs one render, not hundreds.
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

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);

  const run = useCallback(
    async (q: string, mode: "live" | "demo") => {
      stop();
      const ctrl = new AbortController();
      abort.current = ctrl;
      dispatch({ type: "start", substance: q, mode });
      try {
        const r = await fetch(streamUrl(q, mode), { signal: ctrl.signal, headers: { accept: "text/event-stream" } });
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
        if ((e as Error)?.name !== "AbortError") dispatch({ type: "error", message: "Lost connection to the TruthGraph API. Is the backend running on :8100?" });
      }
    },
    [push, stop],
  );

  /** Load a stored graph from FalkorDB and replay its assembly in structural order. */
  const load = useCallback(
    async (key: string, animate = true) => {
      stop();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const snap = await getSnapshot(key);
        const nodes = [...snap.nodes].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
        const edges = [...snap.edges].sort((a, b) => EDGE_ORDER.indexOf(a.type) - EDGE_ORDER.indexOf(b.type));
        if (!animate) {
          dispatch({ type: "snapshot", snap, nodes, edges, final: true });
          return;
        }
        dispatch({ type: "start", substance: snap.name, mode: "live" });
        const steps = 36;
        for (let i = 1; i <= steps; i++) {
          if (ctrl.signal.aborted) return;
          const ns = nodes.slice(0, Math.ceil((nodes.length * i) / steps));
          const ids = new Set(ns.map((n) => n.id));
          const es = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).slice(0, Math.ceil((edges.length * i) / steps));
          dispatch({ type: "snapshot", snap, nodes: ns, edges: es, final: i === steps });
          await new Promise((r) => setTimeout(r, 45));
        }
      } catch (e) {
        dispatch({ type: "error", message: (e as Error)?.message ?? "Could not load graph" });
      }
    },
    [stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { state, run, load, stop, reset: () => dispatch({ type: "reset" }) };
}
