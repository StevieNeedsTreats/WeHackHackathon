import type { GEdge, GNode, Health, Insights, Metric, Stats, SubstanceSummary, Flag } from "./types";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8100";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export const getHealth = () => json<Health>("/api/health");
export const getSubstances = () => json<SubstanceSummary[]>("/api/substances");
export const screen = (q: string) =>
  json<{ ok: boolean; message: string; code: string }>("/api/screen", { method: "POST", body: JSON.stringify({ q }) });

export interface Snapshot {
  key: string;
  name: string;
  nodes: GNode[];
  edges: GEdge[];
  insights: Insights | null;
  metrics: Metric[] | null;
  stats: Stats | null;
  flags: Flag[] | null;
  ms: number;
}
export const getSnapshot = (key: string) => json<Snapshot>(`/api/graph/${encodeURIComponent(key)}`);
export const getBenchmarks = (key: string) => json<Metric[]>(`/api/benchmarks/${encodeURIComponent(key)}`);

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  ms: number;
}
export const runQuery = (cypher: string, key?: string) =>
  json<QueryResult>("/api/query", { method: "POST", body: JSON.stringify({ cypher, key }) });

export function streamUrl(q: string, mode: "live" | "demo") {
  return `${API}/api/research/stream?q=${encodeURIComponent(q)}&mode=${mode}`;
}
