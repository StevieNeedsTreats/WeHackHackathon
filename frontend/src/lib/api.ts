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

// ---- question snapshot cache: prefetch on intent, show cached instantly, revalidate behind it

type Cached = { snap: Snapshot; sig: string; at: number };
const snaps = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();
const PREFETCH_FRESH_MS = 30_000;

function fetchSnapshot(id: string): Promise<Cached> {
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = (async () => {
    const r = await fetch(`${API}/api/question/${encodeURIComponent(id)}`);
    if (!r.ok) {
      let msg = `${r.status}`;
      try {
        msg = (await r.json()).detail ?? msg;
      } catch {}
      throw new Error(msg);
    }
    const text = await r.text();
    // The server's timing field changes on every request; leave it out of the change check.
    const entry = { snap: JSON.parse(text) as Snapshot, sig: text.replace(/"ms":[\d.]+/g, ""), at: Date.now() };
    if (!entry.snap.running) snaps.set(id, entry);
    return entry;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Warm the cache when the user is about to open a question (hover / focus). */
export function prefetchQuestion(id: string) {
  const c = snaps.get(id);
  if ((c && Date.now() - c.at < PREFETCH_FRESH_MS) || inflight.has(id)) return;
  fetchSnapshot(id).catch(() => {});
}

/** The last finished snapshot seen for a question, if any. */
export const cachedQuestion = (id: string) => snaps.get(id)?.snap;

/** Fetch a fresh snapshot; `changed` says whether it differs from what was cached before. */
export async function loadQuestion(id: string): Promise<{ snap: Snapshot; changed: boolean }> {
  const before = snaps.get(id)?.sig;
  const fresh = await (inflight.get(id) ?? fetchSnapshot(id));
  return { snap: fresh.snap, changed: fresh.sig !== before };
}

export const forgetQuestion = (id: string) => {
  snaps.delete(id);
};
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
