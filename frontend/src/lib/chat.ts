"use client";

import { useSyncExternalStore } from "react";
import { forgetQuestion } from "./api";
import { API, authFetch } from "./auth";
import { sse, type Ev } from "./store";

/*
 * Chat and paper uploads, one conversation per question. Kept outside React so an answer that
 * is streaming, or papers being added, carry on when the panel unmounts (another tab, another
 * question). Updates are batched to one render per frame.
 */

export type Part =
  | { kind: "text"; text: string }
  | { kind: "query"; cypher: string; rows?: number; ms?: number; error?: string }
  | { kind: "lookup"; text: string; papers: number; concepts: number; ms: number }
  // any other MCP tool: its summary, and the graph nodes ("paper:ID" / "finding:ID") its result rests on
  | { kind: "tool"; name: string; args: Record<string, unknown>; summary?: string; error?: string; ms?: number; nodes: string[] }
  | { kind: "job"; job: string };

export interface Suggestion {
  title: string;
  label?: string;
  year?: number;
  doi?: string;
  ref: string;
}

export interface JobItem {
  label: string;
  status: string; // queued | resolving | found | screening | reading | added | rejected | duplicate | failed
  detail: string;
  paper_id?: string;
  title?: string;
  paper_label?: string;
  hypotheses?: string[];
  suggestions?: Suggestion[];
}

export interface Job {
  id: string;
  status: "running" | "done" | "failed";
  items: JobItem[];
  detail?: string;
  added?: number;
}

export interface Msg {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  status: "streaming" | "done" | "error";
  error?: string;
  aliases?: Record<string, string>;
}

export interface Conversation {
  messages: Msg[];
  jobs: Record<string, Job>;
}

const EMPTY: Conversation = { messages: [], jobs: {} };
const convs = new Map<string, Conversation>();
const listeners = new Set<() => void>();
const answering = new Map<string, AbortController>();
let frame: number | null = null;

function notify() {
  if (frame != null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    listeners.forEach((l) => l());
  });
}

function update(qid: string, fn: (c: Conversation) => Conversation) {
  convs.set(qid, fn(convs.get(qid) ?? EMPTY));
  notify();
}

function patchMsg(qid: string, id: string, fn: (m: Msg) => Msg) {
  update(qid, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)) }));
}

function patchJob(qid: string, id: string, fn: (j: Job) => Job) {
  update(qid, (c) => (c.jobs[id] ? { ...c, jobs: { ...c.jobs, [id]: fn(c.jobs[id]) } } : c));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useConversation(qid: string | null | undefined): Conversation {
  return useSyncExternalStore(subscribe, () => (qid && convs.get(qid)) || EMPTY, () => EMPTY);
}

export const isAnswering = (qid: string) => answering.has(qid);

// ---- where graph events from added papers go (the open canvas), set by the page

type Sink = { apply: (qid: string, ev: Ev) => void; changed: (qid: string) => void };
let sink: Sink | null = null;
export function setGraphSink(s: Sink | null) {
  sink = s;
}

const uid = () => Math.random().toString(36).slice(2, 10);

async function errorOf(r: Response) {
  try {
    return (await r.json()).detail ?? `${r.status}`;
  } catch {
    return `Request failed (${r.status})`;
  }
}

/** Text the model sees for a past message: its words, without tool traces. */
const textOf = (m: Msg) =>
  m.parts
    .filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("")
    .trim();

// ---- chat

/** What the user put in context: hypothesis keys, and graph ids ("p:…", "f:…", "c:…"). */
export interface ChatContext {
  hypotheses: string[];
  selected: string[];
}

export async function send(qid: string, text: string, ctx: ChatContext) {
  if (answering.has(qid)) return;
  const prior = (convs.get(qid) ?? EMPTY).messages;
  const user: Msg = { id: uid(), role: "user", parts: [{ kind: "text", text }], status: "done" };
  const reply: Msg = { id: uid(), role: "assistant", parts: [], status: "streaming" };
  update(qid, (c) => ({ ...c, messages: [...c.messages, user, reply] }));
  const history = [...prior, user]
    .filter((m) => m.status !== "error")
    .map((m) => ({ role: m.role, content: textOf(m) }))
    .filter((m) => m.content)
    .slice(-20);

  const ctrl = new AbortController();
  answering.set(qid, ctrl);
  const append = (part: Part) => patchMsg(qid, reply.id, (m) => ({ ...m, parts: [...m.parts, part] }));
  try {
    const r = await authFetch(`${API}/api/chat`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ qid, hypotheses: ctx.hypotheses, selected: ctx.selected, messages: history }),
    });
    if (!r.ok || !r.body) throw new Error(await errorOf(r));
    for await (const ev of sse(r.body, ctrl.signal)) {
      const d = ev.data;
      if (ev.event === "delta") {
        patchMsg(qid, reply.id, (m) => {
          const last = m.parts[m.parts.length - 1];
          const parts = last?.kind === "text" ? [...m.parts.slice(0, -1), { ...last, text: last.text + d.text }] : [...m.parts, { kind: "text" as const, text: d.text }];
          return { ...m, parts };
        });
      } else if (ev.event === "aliases") patchMsg(qid, reply.id, (m) => ({ ...m, aliases: d }));
      else if (ev.event === "query") append({ kind: "query", cypher: d.cypher, rows: d.rows, ms: d.ms, error: d.error });
      else if (ev.event === "lookup") append({ kind: "lookup", text: d.text, papers: d.papers, concepts: d.concepts, ms: d.ms });
      else if (ev.event === "tool") append({ kind: "tool", name: d.name, args: d.args ?? {}, summary: d.summary ?? undefined, error: d.error ?? undefined, ms: d.ms, nodes: d.nodes ?? [] });
      else if (ev.event === "ingest") {
        append({ kind: "job", job: d.job });
        void follow(qid, d.job, d.refs ?? []);
      } else if (ev.event === "error") throw new Error(d.message);
      else if (ev.event === "done") break;
    }
    patchMsg(qid, reply.id, (m) => ({ ...m, status: "done" }));
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    patchMsg(qid, reply.id, (m) => ({ ...m, status: aborted ? "done" : "error", error: aborted ? undefined : (e as Error).message }));
  } finally {
    answering.delete(qid);
    notify();
  }
}

export function stopAnswer(qid: string) {
  answering.get(qid)?.abort();
}

export function clearConversation(qid: string) {
  stopAnswer(qid);
  convs.delete(qid);
  notify();
}

// ---- adding papers

/** Add papers (DOIs, links, titles and/or files) to a question; progress shows in its conversation. */
export async function addPapers(qid: string, refs: string[], files: File[]) {
  const labels = [...refs, ...files.map((f) => f.name)];
  const note: Msg = { id: uid(), role: "user", parts: [{ kind: "text", text: `Add ${labels.length === 1 ? "this paper" : `${labels.length} papers`}: ${labels.join(", ")}` }], status: "done" };
  update(qid, (c) => ({ ...c, messages: [...c.messages, note] }));
  const fd = new FormData();
  fd.set("refs", refs.join("\n"));
  for (const f of files) fd.append("files", f);
  try {
    const r = await authFetch(`${API}/api/question/${encodeURIComponent(qid)}/papers`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await errorOf(r));
    const { job } = (await r.json()) as { job: string };
    update(qid, (c) => ({ ...c, messages: [...c.messages, { id: uid(), role: "assistant", parts: [{ kind: "job", job }], status: "done" }] }));
    await follow(qid, job, labels);
  } catch (e) {
    update(qid, (c) => ({ ...c, messages: [...c.messages, { id: uid(), role: "assistant", parts: [], status: "error", error: (e as Error).message }] }));
  }
}

/** Follow an ingest job: item progress into the conversation, graph events onto the canvas. */
async function follow(qid: string, job: string, labels: string[]) {
  update(qid, (c) => ({ ...c, jobs: { ...c.jobs, [job]: { id: job, status: "running", items: labels.map((label) => ({ label, status: "queued", detail: "" })) } } }));
  const ctrl = new AbortController();
  try {
    const r = await authFetch(`${API}/api/ingest/${job}/stream`, { signal: ctrl.signal, headers: { accept: "text/event-stream" } });
    if (!r.ok || !r.body) throw new Error(await errorOf(r));
    for await (const ev of sse(r.body, ctrl.signal)) {
      if (ev.event === "end") break;
      if (ev.event !== "ingest") {
        sink?.apply(qid, ev);
        continue;
      }
      const { _t, ...d } = ev.data;
      void _t;
      if (typeof d.item === "number") {
        patchJob(qid, job, (j) => ({ ...j, items: j.items.map((it, i) => (i === d.item ? { ...it, ...d } : it)) }));
      } else if (d.status === "started") {
        patchJob(qid, job, (j) => ({ ...j, items: (d.items as string[]).map((label, i) => j.items[i] ?? { label, status: "queued", detail: "" }) }));
      } else if (d.status === "queued") patchJob(qid, job, (j) => ({ ...j, detail: d.detail }));
      else if (d.status === "done") patchJob(qid, job, (j) => ({ ...j, status: "done", added: d.added, detail: undefined }));
      else if (d.status === "failed") patchJob(qid, job, (j) => ({ ...j, status: "failed", detail: d.detail }));
    }
  } catch (e) {
    patchJob(qid, job, (j) => ({ ...j, status: "failed", detail: (e as Error).message }));
  } finally {
    patchJob(qid, job, (j) => (j.status === "running" ? { ...j, status: "done" } : j));
    forgetQuestion(qid); // the cached snapshot no longer matches the graph
    sink?.changed(qid);
  }
}
