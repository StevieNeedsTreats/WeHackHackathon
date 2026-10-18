"use client";

import {
  ArrowUp,
  Ban,
  Check,
  Coins,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  FileUp,
  GitFork,
  Info,
  Link2,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  Network,
  Plus,
  Scale,
  Search,
  Square,
  Trash2,
  Waypoints,
  Wrench,
  X,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addPapers, clearConversation, send, stopAnswer, trailOf, useConversation, type Job, type Msg, type Part, type TracePath, type Trail } from "@/lib/chat";
import type { State } from "@/lib/store";
import { Cite, Markdown, type CiteHandlers } from "../chat/Markdown";
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
  onTrail: (t: Trail | null) => void;
}

export function ChatPanel({ state, hk, selected, onPeek: peek, onFocus: focus, onRefs, onTrail: trail }: Props) {
  const qid = state.question?.id ?? null;
  const conv = useConversation(qid);
  const [mode, setMode] = useState<"ask" | "add">("ask");
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [full, setFull] = useState(false);
  const [picking, setPicking] = useState(false);
  const ctx = useContextItems(qid, hk ? `h:${hk}` : null, selected);
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

  // Esc leaves full screen (unless it is closing the context picker).
  useEffect(() => {
    if (!full) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && !picking && setFull(false);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [full, picking]);

  // The composer remounts when moving in or out of full screen; keep the cursor in it.
  const toggled = useRef(false);
  useEffect(() => {
    if (toggled.current) inputRef.current?.focus();
    toggled.current = true;
  }, [full]);

  // Showing something on the graph needs the graph, so those leave full screen first.
  const onPeek = (id: string) => {
    setFull(false);
    peek(id);
  };
  const onFocus = (key: string) => {
    setFull(false);
    focus(key);
  };
  const onTrail = (t: Trail | null) => {
    setFull(false);
    trail(t);
  };
  const h: CiteHandlers = { state, hk, onPeek, onFocus, onRefs, onTrail };
  const payload = () => ({
    hypotheses: ctx.items.filter((x) => x.startsWith("h:")).map((x) => x.slice(2)),
    selected: ctx.items.filter((x) => !x.startsWith("h:")),
  });

  const submit = () => {
    const v = text.trim();
    if (!qid || !v || !ready) return;
    stick.current = true;
    if (mode === "add") {
      void addPapers(qid, v.split("\n").map((l) => l.trim()).filter(Boolean), []);
      setMode("ask");
    } else {
      if (busy) return;
      void send(qid, v, payload());
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

  const panel = (
    <div
      className={full ? "fixed inset-0 z-50 flex flex-col bg-background" : "relative flex h-full min-h-0 flex-col"}
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
        <div className={`space-y-4 px-4 py-4 ${full ? "mx-auto w-full max-w-3xl py-8" : ""}`}>
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
                      void send(qid, s, payload());
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

      <div className={`shrink-0 border-t bg-card px-3 pb-3 pt-2 ${full ? "px-4 pb-5" : ""}`}>
        <div className={full ? "mx-auto w-full max-w-3xl" : ""}>
        <div className="mb-1.5 flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <span className="shrink-0 py-px leading-5">Context</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {ctx.items.length === 0 && <span className="rounded bg-muted/60 px-1.5 py-px italic leading-4">Whole question</span>}
            {ctx.items.map((id) => {
              const label = describeItem(state, id);
              return (
                <span key={id} className="flex h-5 min-w-0 max-w-full items-center gap-0.5 rounded bg-muted pl-1.5 text-ink-2" title={label}>
                  <span className="truncate">{label}</span>
                  <button
                    type="button"
                    className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-line-2/60 hover:text-ink"
                    onClick={() => ctx.remove(id)}
                    aria-label={`Remove ${label} from context`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            <Popover open={picking} onOpenChange={setPicking}>
              <Tip label="Add to context">
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-5 rounded text-muted-foreground" aria-label="Add to context">
                    <Plus className="size-3.5" />
                  </Button>
                </PopoverTrigger>
              </Tip>
              <PopoverContent align="start" side="top" className="w-80 p-0">
                <ContextPicker
                  state={state}
                  exclude={ctx.items}
                  onPick={(id) => {
                    ctx.add(id);
                    setPicking(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex shrink-0 items-center">
            {conv.messages.length > 0 && (
              <Tip label="Clear conversation">
                <Button variant="ghost" size="icon" className="size-5 text-muted-foreground" onClick={() => clearConversation(qid)} aria-label="Clear conversation">
                  <Trash2 className="size-3" />
                </Button>
              </Tip>
            )}
            <Tip label={full ? "Exit full screen (Esc)" : "Full screen"}>
              <Button variant="ghost" size="icon" className="size-5 text-muted-foreground" onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full}>
                {full ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
              </Button>
            </Tip>
          </div>
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
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ring bg-background/90 text-[13px] text-ink-2">
          <FileUp className="size-6 text-ink-3" />
          Drop to add to this question
          <span className="text-[12.5px] text-muted-foreground">PDF or text, up to 8 files</span>
        </div>
      )}
    </div>
  );
  // Full screen covers the page from <body>, clear of the resizable panel around this one.
  return full ? createPortal(panel, document.body) : panel;
}

/**
 * The chat's context: the focused hypothesis and the selected graph node join it as they change
 * (and leave when they change again), and the user adds items with + and removes any with x.
 */
function useContextItems(qid: string | null, focused: string | null, selected: string | null) {
  const [pinned, setPinned] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [seen, setSeen] = useState({ qid, focused, selected });
  // Reset during render when the inputs change, so a new focus or selection shows at once.
  if (seen.qid !== qid || seen.focused !== focused || seen.selected !== selected) {
    if (seen.qid !== qid) setPinned([]);
    setHidden((h) => h.filter((x) => x !== focused && x !== selected && seen.qid === qid));
    setSeen({ qid, focused, selected });
  }
  const auto = [focused, selected && /^[pfc]:/.test(selected) ? selected : null].filter((x): x is string => !!x && !hidden.includes(x));
  const items = [...new Set([...auto, ...pinned])];
  return {
    items,
    add: (id: string) => {
      setPinned((p) => (p.includes(id) ? p : [...p, id]));
      setHidden((h) => h.filter((x) => x !== id));
    },
    remove: (id: string) => {
      setPinned((p) => p.filter((x) => x !== id));
      if (id === focused || id === selected) setHidden((h) => [...h, id]);
    },
  };
}

function describeItem(state: State, id: string): string {
  const rest = id.slice(2);
  if (id.startsWith("h:")) {
    const hyp = state.hyps[rest];
    return hyp ? `H${state.hypOrder.indexOf(rest) + 1}: ${hyp.statement}` : "Hypothesis";
  }
  if (id.startsWith("p:")) return state.papers[rest]?.label ?? "Paper";
  if (id.startsWith("f:")) return state.findings[rest]?.text ?? "Finding";
  return "Contradiction";
}

const PICK_LIMIT = 150;

function ContextPicker({ state, exclude, onPick }: { state: State; exclude: string[]; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set(exclude);
  const hyps = state.hypOrder.filter((k) => state.hyps[k] && !out.has(`h:${k}`));
  const papers = Object.values(state.papers).filter((p) => !out.has(`p:${p.id}`));
  const findings = Object.values(state.findings)
    .filter((f) => !out.has(`f:${f.id}`) && words.every((w) => `${f.text} ${state.papers[f.paper_id]?.label ?? ""}`.toLowerCase().includes(w)))
    .slice(0, PICK_LIMIT); // the list is capped, so narrow by the query first
  return (
    <Command>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Hypotheses, papers, findings…" className="text-[12.5px]" />
      <CommandList className="max-h-72">
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {hyps.length > 0 && (
          <CommandGroup heading="Hypotheses">
            {hyps.map((k) => (
              <CommandItem key={k} value={`h:${k} ${state.hyps[k].statement}`} onSelect={() => onPick(`h:${k}`)} className="text-[12.5px]">
                <span className="shrink-0 text-[12px] text-ink-3">H{state.hypOrder.indexOf(k) + 1}</span>
                <span className="line-clamp-2">{state.hyps[k].statement}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {papers.length > 0 && (
          <CommandGroup heading="Papers">
            {papers.map((p) => (
              <CommandItem key={p.id} value={`p:${p.id} ${p.label} ${p.title}`} onSelect={() => onPick(`p:${p.id}`)} className="text-[12.5px]">
                <span className="min-w-0">
                  <span className="block truncate text-ink">{p.label}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{p.title}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {findings.length > 0 && (
          <CommandGroup heading="Findings">
            {findings.map((f) => (
              <CommandItem key={f.id} value={`f:${f.id} ${f.text} ${state.papers[f.paper_id]?.label ?? ""}`} onSelect={() => onPick(`f:${f.id}`)} className="text-[12.5px]">
                <span className="min-w-0">
                  <span className="line-clamp-2">{f.text}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{state.papers[f.paper_id]?.label}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
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
  // A reply whose tools returned routes already shows them (as a tree, and on the graph), so path blocks the
  // model writes out anyway are left out of its text.
  const hh = { ...h, aliases: m.aliases, hidePaths: m.parts.some((p) => p.kind === "tool" && !!p.paths?.length) };
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
      className="h-6 px-1.5 text-[12px] text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100"
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
      <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Search className="size-3" />
        Looked up “{p.text}”: {p.papers} paper{p.papers === 1 ? "" : "s"}, {p.concepts} topic{p.concepts === 1 ? "" : "s"} in {p.ms} ms
      </div>
    );
  if (p.kind === "query")
    return (
      <Collapsible className="group/q rounded-md border bg-surface/60 text-[12.5px]">
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-ink">
          <ChevronRight className="size-3 transition-transform group-data-[state=open]/q:rotate-90" />
          <Database className="size-3" />
          {p.error ? <span className="truncate text-neg-ink">Query failed: {p.error}</span> : <span>Queried the graph: {p.rows} row{p.rows === 1 ? "" : "s"} in {p.ms} ms</span>}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="code max-h-56 overflow-auto whitespace-pre-wrap break-words border-t px-2.5 py-2 text-[12px] leading-[1.55] text-ink-2">{p.cypher}</pre>
        </CollapsibleContent>
      </Collapsible>
    );
  if (p.kind === "tool") return <ToolCard p={p} h={h} />;
  const job = jobs[p.job];
  return job ? <JobCard job={job} h={h} onRetry={onRetry} /> : null;
}

const TOOLS: Record<string, { label: string; icon: React.ReactNode }> = {
  explain_verdict: { label: "Explained the verdict", icon: <Scale className="size-3" /> },
  trace_path: { label: "Traced connections", icon: <Waypoints className="size-3" /> },
  follow_evidence: { label: "Followed the evidence", icon: <Coins className="size-3" /> },
  influential_papers: { label: "Ranked papers by citation influence", icon: <Network className="size-3" /> },
  contradiction_clusters: { label: "Found where the evidence splits", icon: <GitFork className="size-3" /> },
  question_overview: { label: "Read a question overview", icon: <Info className="size-3" /> },
  list_questions: { label: "Listed questions", icon: <Database className="size-3" /> },
};

/** A call to one of the MCP server's tools. Hovering it lights up the findings its result rests on. */
function ToolCard({ p, h }: { p: Extract<Part, { kind: "tool" }>; h: CiteHandlers }) {
  const t = TOOLS[p.name] ?? { label: p.name, icon: <Wrench className="size-3" /> };
  const papers = new Set(p.nodes.filter((n) => n.startsWith("paper:")).map((n) => n.slice(6)));
  const findings = [
    ...new Set([
      ...p.nodes.filter((n) => n.startsWith("finding:")).map((n) => n.slice(8)),
      ...Object.values(h.state.findings)
        .filter((f) => papers.has(f.paper_id))
        .map((f) => f.id),
    ]),
  ].filter((id) => h.state.findings[id]);
  const args = Object.entries(p.args).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length));
  return (
    <Collapsible
      className="group/q rounded-md border bg-surface/60 text-[12.5px]"
      onMouseEnter={() => findings.length && h.onRefs(findings)}
      onMouseLeave={() => findings.length && h.onRefs(null)}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-ink">
        <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]/q:rotate-90" />
        {t.icon}
        {p.error ? (
          <span className="truncate text-neg-ink">
            {t.label} failed: {p.error}
          </span>
        ) : (
          <span className="truncate">
            {t.label}
            {p.summary ? `: ${p.summary}` : ""}
            {p.ms != null ? ` in ${Math.round(p.ms)} ms` : ""}
          </span>
        )}
      </CollapsibleTrigger>
      {p.name === "follow_evidence" && !!p.paths?.length && <EvidenceTree paths={p.paths} h={h} />}
      <CollapsibleContent>
        <div className="space-y-1 border-t px-2.5 py-2 text-[12px] leading-[1.55] text-ink-2">
          <div className="flex items-center gap-2">
            <span className="code text-ink-3">{p.name}</span>
            {(findings.length > 0 || !!p.paths?.length) && h.onTrail && (
              <Button variant="outline" size="sm" className="ml-auto h-6 gap-1 px-2 text-[12px]" onClick={() => h.onTrail?.(trailOf(p, t.label))}>
                <Waypoints className="size-3" /> Show on graph
              </Button>
            )}
          </div>
          {args.map(([k, v]) => (
            <div key={k} className="code break-words">
              <span className="text-ink-3">{k}:</span> {typeof v === "string" ? v : JSON.stringify(v)}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * follow_evidence's routes (source <- paper -> study -> finding -> hypothesis) folded into the tree they
 * are: each funder, author or lab, the papers it is behind, and each paper's findings with their stance.
 */
function EvidenceTree({ paths, h }: { paths: TracePath[]; h: CiteHandlers }) {
  const sources = new Map<string, { name: string; kind: string; papers: Map<string, { name: string; findings: { id: string; name: string; hyp: string }[] }> }>();
  for (const p of paths) {
    const [src, paper, , finding, hyp] = p.nodes;
    if (!src || !paper || !finding) continue;
    const s = sources.get(src.id) ?? sources.set(src.id, { name: src.name, kind: src.kind, papers: new Map() }).get(src.id)!;
    const pp = s.papers.get(paper.id) ?? s.papers.set(paper.id, { name: paper.name, findings: [] }).get(paper.id)!;
    pp.findings.push({ id: finding.id, name: finding.name, hyp: hyp?.id ?? "" });
  }
  const hyps = new Set(paths.map((p) => p.nodes[4]?.id));
  const ref = (kind: "paper" | "finding", id: string, name: string) =>
    (kind === "paper" ? h.state.papers[id] : h.state.findings[id]) ? <Cite raw={`${kind}:${id}`} h={h} /> : <span className="text-ink-2">{name}</span>;
  return (
    <div className="space-y-2.5 border-t px-2.5 py-2.5">
      {[...sources.entries()].map(([sid, s]) => (
        <div key={sid}>
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
            <Coins className="size-3 text-ink-3" />
            {s.name}
          </div>
          <ul className="ml-[5px] mt-1.5 space-y-2 border-l border-line-2 pl-3">
            {[...s.papers.entries()].map(([pid, pp]) => (
              <li key={pid}>
                {ref("paper", pid, pp.name)}
                <ul className="mt-1 space-y-1 pl-3">
                  {pp.findings.map((f) => (
                    <li key={f.id} className="flex items-center gap-1 text-[12px] text-ink-3">
                      {ref("finding", f.id, f.name)}
                      {hyps.size > 1 && h.state.hyps[f.hyp] && <span>on H{h.state.hypOrder.indexOf(f.hyp) + 1}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
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
        {job.detail && <span className="ml-auto truncate text-[12px] font-normal text-muted-foreground">{job.detail}</span>}
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
                <div className="text-[12.5px] leading-[1.45] text-muted-foreground">{pending ? ITEM_TEXT[it.status] ?? it.detail : it.detail}</div>
                {it.status === "added" && paper && (
                  <Button variant="link" size="sm" className="h-auto p-0 text-[12.5px]" onClick={() => h.onPeek(`p:${paper.id}`)}>
                    Show {paper.label} on the graph
                  </Button>
                )}
                {it.status === "failed" && !!it.suggestions?.length && (
                  <div className="mt-1.5 space-y-1">
                    <div className="text-[12px] text-muted-foreground">Did you mean</div>
                    {it.suggestions.map((s) => (
                      <Button
                        key={s.ref}
                        variant="outline"
                        size="sm"
                        className="h-auto w-full justify-start whitespace-normal py-1 text-left text-[12.5px] font-normal"
                        onClick={() => onRetry(s.ref)}
                      >
                        <span className="min-w-0">
                          {s.title}
                          <span className="text-muted-foreground">, {[s.label, s.doi].filter(Boolean).join(", ")}</span>
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
