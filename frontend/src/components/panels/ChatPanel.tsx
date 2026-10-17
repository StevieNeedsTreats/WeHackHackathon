"use client";

import {
  ArrowUp,
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  FileUp,
  Info,
  Link2,
  LoaderCircle,
  MessageSquare,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addPapers, clearConversation, send, stopAnswer, useConversation, type Job, type Msg, type Part } from "@/lib/chat";
import type { State } from "@/lib/store";
import { Markdown, type CiteHandlers } from "../chat/Markdown";
import { Tip } from "../Tip";

const SUGGESTIONS = [
  "Summarise what the evidence says, and how strong it is",
  "Which studies disagree, and why?",
  "Who funded the studies on each side?",
  "What evidence is missing?",
];
const ACCEPT = ".pdf,.txt,.md,application/pdf,text/plain";

interface Props {
  state: State;
  hk: string | null;
  selected: string | null;
  onPeek: (nodeId: string) => void;
  onFocus: (key: string) => void;
  onRefs: (ids: string[] | null) => void;
}

export function ChatPanel({ state, hk, selected, onPeek, onFocus, onRefs }: Props) {
  const qid = state.question?.id ?? null;
  const conv = useConversation(qid);
  const [mode, setMode] = useState<"ask" | "add">("ask");
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const last = conv.messages[conv.messages.length - 1];
  const busy = last?.role === "assistant" && last.status === "streaming";
  const researching = state.status === "streaming";
  const ready = !!qid && !researching && state.status !== "error";

  // Follow new content while the reader is at the bottom; leave them be once they scroll up.
  useLayoutEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [conv]);
  useEffect(() => {
    const el = viewport.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (!el) return;
    const on = () => (stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60);
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);

  const h: CiteHandlers = { state, hk, onPeek, onFocus, onRefs };

  const submit = () => {
    const v = text.trim();
    if (!qid || !v || !ready) return;
    stick.current = true;
    if (mode === "add") {
      void addPapers(qid, v.split("\n").map((l) => l.trim()).filter(Boolean), []);
      setMode("ask");
    } else {
      if (busy) return;
      void send(qid, v, { hypothesis: hk, selected });
    }
    setText("");
  };
  const upload = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter((f) => /\.(pdf|txt|md)$/i.test(f.name) || f.type === "application/pdf" || f.type.startsWith("text/"));
    if (!qid || !ready || !list.length) return;
    stick.current = true;
    void addPapers(qid, [], list.slice(0, 8));
  };

  if (!qid)
    return (
      <Empty icon={<MessageSquare className="size-5" />} title="Chat with the evidence" body="Open or research a question, then ask about its studies, verdicts and contradictions, or add papers to it." />
    );

  const sel = selected ? describeSelected(state, selected) : null;
  const hyp = hk ? state.hyps[hk] : null;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (!ready || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      <ScrollArea ref={viewport} className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-4">
          {conv.messages.length === 0 ? (
            <div className="pt-2">
              <p className="text-[13px] leading-[1.6] text-ink-2">
                Ask about this question&apos;s studies, verdicts and contradictions, or anything else in the graph. Answers cite the papers and findings they rest on; click one to see it on the
                graph.
              </p>
              <div className="mt-3 flex flex-col items-start gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    disabled={!ready}
                    className="h-auto whitespace-normal rounded-full bg-card py-1 text-left font-normal text-ink-2"
                    onClick={() => {
                      stick.current = true;
                      void send(qid, s, { hypothesis: hk, selected });
                    }}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-[1.5] text-muted-foreground">
                <FileUp className="mt-px size-3.5 shrink-0" />
                Drop PDFs here, or switch to Add paper to give a DOI, link or title. Papers that don&apos;t bear on this question are turned away.
              </p>
            </div>
          ) : (
            conv.messages.map((m) => <Message key={m.id} m={m} jobs={conv.jobs} h={h} onRetry={(ref) => qid && void addPapers(qid, [ref], [])} />)
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-card px-3 pb-3 pt-2">
        <div className="mb-1.5 flex min-h-5 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="shrink-0">Context</span>
          <span className="min-w-0 truncate rounded bg-muted px-1.5 py-px text-ink-2" title={hyp?.statement ?? "All hypotheses"}>
            {hyp ? `H${state.hypOrder.indexOf(hk!) + 1} · ${hyp.statement}` : "All hypotheses"}
          </span>
          {sel && (
            <span className="min-w-0 max-w-[40%] truncate rounded bg-muted px-1.5 py-px text-ink-2" title={sel}>
              {sel}
            </span>
          )}
          {conv.messages.length > 0 && (
            <Tip label="Clear conversation">
              <Button variant="ghost" size="icon" className="ml-auto size-5 shrink-0 text-muted-foreground" onClick={() => clearConversation(qid)} aria-label="Clear conversation">
                <Trash2 className="size-3" />
              </Button>
            </Tip>
          )}
        </div>
        <div className="rounded-lg border bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={!ready}
            rows={1}
            placeholder={
              researching
                ? "Chat opens when the research finishes"
                : mode === "add"
                  ? "DOIs, links or titles with authors, one per line"
                  : "Ask about this research…"
            }
            aria-label={mode === "add" ? "Papers to add" : "Message"}
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as "ask" | "add")}
              variant="outline"
              size="sm"
              className="h-7"
              aria-label="What to send"
            >
              <ToggleGroupItem value="ask" className="h-7 px-2 text-[12px]">
                <MessageSquare className="size-3.5" /> Ask
              </ToggleGroupItem>
              <ToggleGroupItem value="add" className="h-7 px-2 text-[12px]">
                <Link2 className="size-3.5" /> Add paper
              </ToggleGroupItem>
            </ToggleGroup>
            <Tip label="Upload PDF or text files">
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" disabled={!ready} onClick={() => fileRef.current?.click()} aria-label="Upload papers">
                <FileUp className="size-4" />
              </Button>
            </Tip>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                upload(e.target.files);
                e.target.value = "";
              }}
            />
            {busy && mode === "ask" ? (
              <Button size="icon" variant="secondary" className="ml-auto size-7" onClick={() => stopAnswer(qid)} aria-label="Stop answering">
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button size="icon" className="ml-auto size-7" disabled={!ready || !text.trim()} onClick={submit} aria-label={mode === "add" ? "Add papers" : "Send"}>
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ring bg-background/90 text-[13px] text-ink-2">
          <FileUp className="size-6 text-ink-3" />
          Drop to add to this question
          <span className="text-[11.5px] text-muted-foreground">PDF or text, up to 8 files</span>
        </div>
      )}
    </div>
  );
}

function describeSelected(state: State, id: string): string | null {
  if (id.startsWith("p:")) return state.papers[id.slice(2)]?.label ?? null;
  if (id.startsWith("f:")) return state.findings[id.slice(2)]?.text ?? null;
  if (id.startsWith("c:")) return "Contradiction";
  return null;
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-ink-3">{icon}</div>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      <p className="max-w-[280px] text-[12.5px] leading-[1.55] text-muted-foreground">{body}</p>
    </div>
  );
}

const Message = memo(function Message({ m, jobs, h, onRetry }: { m: Msg; jobs: Record<string, Job>; h: CiteHandlers; onRetry: (ref: string) => void }) {
  if (m.role === "user") {
    const t = m.parts[0]?.kind === "text" ? m.parts[0].text : "";
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[13px] leading-[1.55] text-ink">{t}</div>
      </div>
    );
  }
  const hh = { ...h, aliases: m.aliases };
  const empty = m.parts.every((p) => p.kind === "text" && !p.text.trim());
  return (
    <div className="group/msg space-y-2">
      {m.parts.map((p, i) => (
        <PartView key={i} p={p} jobs={jobs} h={hh} onRetry={onRetry} />
      ))}
      {m.status === "streaming" && empty && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> Reading the graph…
        </div>
      )}
      {m.status === "error" && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-neg-soft/50 px-2.5 py-1.5 text-[12.5px] text-neg-ink">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {m.error ?? "Something went wrong"}
        </div>
      )}
      {m.status === "done" && !empty && m.parts.some((p) => p.kind === "text") && <CopyButton m={m} />}
    </div>
  );
});

function CopyButton({ m }: { m: Msg }) {
  const [done, setDone] = useState(false);
  const text = m.parts.map((p) => (p.kind === "text" ? p.text : "")).join("").trim();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? "Copied" : "Copy"}
    </Button>
  );
}

function PartView({ p, jobs, h, onRetry }: { p: Part; jobs: Record<string, Job>; h: CiteHandlers; onRetry: (ref: string) => void }) {
  if (p.kind === "text") return p.text.trim() ? <Markdown text={p.text.trim()} h={h} /> : null;
  if (p.kind === "lookup")
    return (
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Search className="size-3" />
        Looked up “{p.text}” · {p.papers} paper{p.papers === 1 ? "" : "s"}, {p.concepts} topic{p.concepts === 1 ? "" : "s"} · {p.ms} ms
      </div>
    );
  if (p.kind === "query")
    return (
      <Collapsible className="group/q rounded-md border bg-surface/60 text-[11.5px]">
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-ink">
          <ChevronRight className="size-3 transition-transform group-data-[state=open]/q:rotate-90" />
          <Database className="size-3" />
          {p.error ? <span className="truncate text-neg-ink">Query failed: {p.error}</span> : <span>Queried the graph · {p.rows} row{p.rows === 1 ? "" : "s"} · {p.ms} ms</span>}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mono max-h-56 overflow-auto whitespace-pre-wrap break-words border-t px-2.5 py-2 text-[11px] leading-[1.55] text-ink-2">{p.cypher}</pre>
        </CollapsibleContent>
      </Collapsible>
    );
  const job = jobs[p.job];
  return job ? <JobCard job={job} h={h} onRetry={onRetry} /> : null;
}

const ITEM_ICON: Record<string, React.ReactNode> = {
  added: <Check className="size-3.5 text-pos-ink" />,
  rejected: <Ban className="size-3.5 text-ink-3" />,
  duplicate: <Info className="size-3.5 text-ink-3" />,
  failed: <X className="size-3.5 text-neg-ink" />,
};
const ITEM_TEXT: Record<string, string> = {
  queued: "Waiting",
  resolving: "Looking it up",
  found: "Found",
  screening: "Checking relevance",
  reading: "Reading and scoring",
};

function JobCard({ job, h, onRetry }: { job: Job; h: CiteHandlers; onRetry: (ref: string) => void }) {
  const n = job.items.length;
  const head =
    job.status === "running"
      ? `Adding ${n} paper${n === 1 ? "" : "s"}`
      : job.status === "failed"
        ? "Couldn't add papers"
        : `Added ${job.added ?? 0} of ${n} paper${n === 1 ? "" : "s"}`;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b bg-surface/60 px-3 py-1.5 text-[12px] font-medium text-ink">
        {job.status === "running" ? <LoaderCircle className="size-3.5 animate-spin text-ink-3" /> : <FileUp className="size-3.5 text-ink-3" />}
        {head}
        {job.detail && <span className="ml-auto truncate text-[11px] font-normal text-muted-foreground">{job.detail}</span>}
      </div>
      <ul className="divide-y">
        {job.items.map((it, i) => {
          const pending = !ITEM_ICON[it.status];
          const paper = it.paper_id ? h.state.papers[it.paper_id] : null;
          return (
            <li key={i} className="flex items-start gap-2 px-3 py-2">
              <span className="mt-0.5 shrink-0">{pending ? <LoaderCircle className="size-3.5 animate-spin text-ink-3" /> : ITEM_ICON[it.status]}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-ink" title={it.title ?? it.label}>
                  {it.title ?? it.label}
                </div>
                <div className="text-[11.5px] leading-[1.45] text-muted-foreground">{pending ? ITEM_TEXT[it.status] ?? it.detail : it.detail}</div>
                {it.status === "added" && paper && (
                  <Button variant="link" size="sm" className="h-auto p-0 text-[11.5px]" onClick={() => h.onPeek(`p:${paper.id}`)}>
                    Show {paper.label} on the graph
                  </Button>
                )}
                {it.status === "failed" && !!it.suggestions?.length && (
                  <div className="mt-1.5 space-y-1">
                    <div className="text-[11px] text-muted-foreground">Did you mean</div>
                    {it.suggestions.map((s) => (
                      <Button
                        key={s.ref}
                        variant="outline"
                        size="sm"
                        className="h-auto w-full justify-start whitespace-normal py-1 text-left text-[11.5px] font-normal"
                        onClick={() => onRetry(s.ref)}
                      >
                        <span className="min-w-0">
                          {s.title}
                          <span className="text-muted-foreground"> · {[s.label, s.doi].filter(Boolean).join(" · ")}</span>
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
