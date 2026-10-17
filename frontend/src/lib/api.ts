import type {
  Cluster,
  Contradiction,
  Finding,
  Flag,
  Health,
  Hypothesis,
  Interpretation,
  Metric,
  Paper,
  QuestionSummary,
  Stats,
  Study,
  Verdict,
} from "./types";

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
export const getQuestions = () => json<QuestionSummary[]>("/api/questions");
export const interpret = (text: string, mode: "live" | "demo") =>
  json<Interpretation>("/api/interpret", { method: "POST", body: JSON.stringify({ text, mode }) });

export interface Snapshot {
  question: { id: string; text: string; domain: string };
  hypotheses: Hypothesis[];
  papers: (Paper & { cred_reasons?: Paper["reasons"]; sample_size?: number })[];
  studies: Study[];
  findings: Finding[];
  clusters: Cluster[];
  contradictions: Contradiction[];
  cites: [string, string][];
  verdicts: Record<string, Verdict | null>;
  metrics: Metric[] | null;
  stats: Stats | null;
  flags: Flag[];
  disclaimer: string;
  running: boolean;
  ms: number;
}
export const getQuestion = (id: string) => json<Snapshot>(`/api/question/${encodeURIComponent(id)}`);
export const deleteQuestion = (id: string) =>
  json<{ deleted: string; hypotheses: string[] }>(`/api/question/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getBenchmarks = (id: string) => json<Metric[]>(`/api/benchmarks/${encodeURIComponent(id)}`);

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  ms: number;
}
export const runQuery = (cypher: string, qid?: string) =>
  json<QueryResult>("/api/query", { method: "POST", body: JSON.stringify({ cypher, qid }) });

export interface Edits {
  keep?: string[];
  population?: Record<string, string | null>;
  fresh?: boolean;
}

export function streamUrl(q: string, mode: "live" | "demo", edits?: Edits) {
  const e = edits && Object.keys(edits).length ? `&edits=${encodeURIComponent(JSON.stringify(edits))}` : "";
  return `${API}/api/research/stream?q=${encodeURIComponent(q)}&mode=${mode}${e}`;
}

export const attachUrl = (qid: string) => `${API}/api/research/attach?qid=${encodeURIComponent(qid)}`;
export const stopRun = (qid: string) => json<{ stopped: string }>(`/api/research/stop?qid=${encodeURIComponent(qid)}`, { method: "POST" });
