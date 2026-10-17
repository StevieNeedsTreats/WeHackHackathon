"use client";

import { CircleAlert, ShieldAlert } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentRail } from "@/components/AgentRail";
import { CompareView } from "@/components/CompareView";
import GraphCanvas from "@/components/graph/GraphCanvas";
import { EXAMPLES, Header } from "@/components/Header";
import { HypothesisBar, type Focus } from "@/components/HypothesisBar";
import { InterpretationCard } from "@/components/InterpretationCard";
import { CollapseButton, Shell } from "@/components/Shell";
import { ChatPanel } from "@/components/panels/ChatPanel";
import { DetailsPanel } from "@/components/panels/DetailsPanel";
import { EvidencePanel } from "@/components/panels/EvidencePanel";
import { QueriesPanel } from "@/components/panels/QueriesPanel";
import { VerdictPanel } from "@/components/panels/VerdictPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setGraphSink, type Trail } from "@/lib/chat";
import { deleteQuestion, forgetQuestion, getHealth, warmQuestions, getQuestions, interpret, type Edits } from "@/lib/api";
import { notify } from "@/lib/notify";
import { useResearch } from "@/lib/store";
import { useStableCallback } from "@/lib/use-stable-callback";
import type { Guardrail, Health, Interpretation, QuestionSummary } from "@/lib/types";

// Memoised once at module level: with stable handlers below, a panel re-renders only when its
// own inputs change (not on every hover or tab switch elsewhere on the page).
const Rail = memo(AgentRail);
const Graph = memo(GraphCanvas);
const Compare = memo(CompareView);
const Hyps = memo(HypothesisBar);
const VerdictTab = memo(VerdictPanel);
const EvidenceTab = memo(EvidencePanel);
const QueriesTab = memo(QueriesPanel);
const DetailsTab = memo(DetailsPanel);
const ChatTab = memo(ChatPanel);

type Tab = "verdict" | "evidence" | "chat" | "queries" | "details";
const TABS: { id: Tab; label: string }[] = [
  { id: "verdict", label: "Verdict" },
  { id: "evidence", label: "Evidence" },
  { id: "chat", label: "Chat" },
  { id: "queries", label: "Queries" },
  { id: "details", label: "Details" },
];

export default function Home({ defaultLayout }: { defaultLayout?: Record<string, number> }) {
  const { state, run, load, detach, absorb, stop, reset } = useResearch();
  const [health, setHealth] = useState<Health | null>(null);
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<Guardrail | null>(null);
  const [focus, setFocus] = useState<Focus>("all");
  const [tab, setTab] = useState<Tab>("verdict");
  const [selected, setSelected] = useState<string | null>(null);
  const [refs, setRefs] = useState<string[] | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [trail, setTrail] = useState<Trail | null>(null);

  const refresh = useCallback(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getQuestions().then(setQuestions).catch(() => {});
  }, []);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    if (state.status === "done" || state.status === "streaming") refresh();
  }, [state.status, refresh]);
  // Runs keep going in the background; keep the sidebar's running/finished marks current.
  const anyRunning = state.status === "streaming" || questions.some((q) => q.running);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => getQuestions().then(setQuestions).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [anyRunning]);

  // Default focus when a question's hypotheses arrive: Compare for "X vs Y", else the first.
  const qid = state.question?.id;
  const nHyps = state.hypOrder.length;
  // Adjusted during render rather than in an effect, so a new question's first paint already uses
  // its focus: otherwise it drew once in the All layout and again focused.
  const focusKey = nHyps ? qid : undefined;
  const [focusFor, setFocusFor] = useState(focusKey);
  if (focusKey !== focusFor) {
    setFocusFor(focusKey);
    if (focusKey) {
      if (pendingFocus && state.hyps[pendingFocus]) {
        setFocus(pendingFocus);
        setPendingFocus(null);
      } else setFocus(state.question?.compare && nHyps > 1 ? "compare" : state.hypOrder[0]);
    }
  }

  // Warm the cache with every finished question once the list is known, so switching is instant.
  useEffect(() => {
    const ids = questions.filter((q) => !q.running).map((q) => q.id);
    if (!ids.length) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => warmQuestions(ids, ctrl.signal), 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [questions]);

  // Deep links: /?q=<question id>&h=<hypothesis key>
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q");
    if (q) {
      setPendingFocus(p.get("h"));
      load(q);
    }
  }, [load]);
  useEffect(() => {
    if (!qid || state.status !== "done") return;
    const p = new URLSearchParams({ q: qid });
    if (focus !== "all" && focus !== "compare") p.set("h", focus);
    window.history.replaceState(null, "", `?${p}`);
  }, [qid, focus, state.status]);

  const hk = focus !== "all" && focus !== "compare" ? focus : (state.hypOrder[0] ?? null);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    if (id) setTab("details");
  }, []);
  // Chat citations select on the graph without leaving the conversation.
  const peek = useCallback((id: string) => setSelected(id), []);

  // Reasoning drawn on the canvas, from the chat's tool calls. It lives on one hypothesis's canvas,
  // so showing it moves the focus there.
  const showTrail = useStableCallback((t: Trail | null) => {
    setTrail(t);
    if (!t) return;
    const first = t.nodes.find((n) => n.startsWith("finding:"));
    const key =
      t.paths?.[0]?.nodes.find((n) => n.kind === "hypothesis" && state.hyps[n.id])?.id ??
      (focus !== "all" && focus !== "compare" ? null : first ? Object.keys(state.findings[first.slice(8)]?.evidence ?? {})[0] : state.hypOrder[0]);
    if (key && key !== focus && state.hyps[key]) setFocus(key);
  });
  const [trailFor, setTrailFor] = useState(qid);
  if (trailFor !== qid) {
    setTrailFor(qid);
    setTrail(null);
  }
  const trailFromChat = useStableCallback((q: string, t: Trail) => q === state.question?.id && showTrail(t));
  // Papers added from the chat stream their graph updates onto the open canvas.
  useEffect(() => {
    setGraphSink({ apply: absorb, changed: refresh, trail: trailFromChat });
    return () => setGraphSink(null);
  }, [absorb, refresh, trailFromChat]);
  const focusHyp = useCallback((f: Focus) => {
    setFocus(f);
    setSelected(null);
  }, []);
  const ask = useStableCallback(async (text: string) => {
    detach();
    reset();
    setRefusal(null);
    setInterp(null);
    setAsking(true);
    try {
      const r = await interpret(text, "live");
      if (r.ok) setInterp(r);
      else setRefusal(r);
    } catch (e) {
      setRefusal({ ok: false, code: "error", message: (e as Error).message });
    } finally {
      setAsking(false);
    }
  });
  const research = useStableCallback((edits: Edits) => {
    if (!interp?.question) return;
    const text = interp.question.text;
    setInterp(null);
    setSelected(null);
    setTab("verdict");
    run(text, "live", edits);
  });
  const demo = useStableCallback((text: string) => {
    setInterp(null);
    setRefusal(null);
    setSelected(null);
    setTab("verdict");
    run(text, "demo");
  });
  const open = useStableCallback((id: string, key?: string) => {
    setInterp(null);
    setRefusal(null);
    setSelected(null);
    setTab("verdict");
    // Already showing this question (finished or still streaming): just switch hypothesis.
    // Reloading would neither change focus (that only happens when a new question arrives)
    // nor keep a live run's stream.
    if (id === state.question?.id) {
      if (key && state.hyps[key]) setFocus(key);
      return;
    }
    setPendingFocus(key ?? null);
    load(id);
  });

  // A toast when a run finishes, wherever it was started: here, another tab, or an MCP client.
  const wasRunning = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set(questions.filter((q) => q.running).map((q) => q.id));
    const before = wasRunning.current;
    wasRunning.current = now;
    for (const id of before ?? []) {
      const q = questions.find((x) => x.id === id);
      if (!q || now.has(id)) continue;
      const done = q.hypotheses.some((h) => h.verdict);
      notify(done ? "success" : "info", done ? "Research finished" : "Research stopped", {
        description: q.text,
        action: id === state.question?.id ? undefined : { label: "Open", onClick: () => open(id) },
      });
    }
  }, [questions, state.question?.id, open]);
  const remove = useStableCallback(async (id: string) => {
    try {
      await deleteQuestion(id);
      forgetQuestion(id);
    } catch (e) {
      setRefusal({ ok: false, code: "error", message: `Couldn't delete: ${(e as Error).message}` });
      return;
    }
    notify("info", "Question deleted");
    if (state.question?.id === id) {
      detach();
      reset();
      setFocus("all");
      setSelected(null);
      window.history.replaceState(null, "", window.location.pathname);
    }
    refresh();
  });

  const demos = health?.demos;
  const empty = useMemo(() => interp ? (
    <InterpretationCard interp={interp} onRun={research} onCancel={() => setInterp(null)} />
  ) : (
    <div className="pointer-events-auto max-w-[600px] px-6 text-center">
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground">What does the research actually say?</h1>
      <p className="mx-auto mt-3 max-w-[500px] text-[14px] leading-[1.6] text-ink-2">
        Ask about any claim in plain language. Agents split it into testable hypotheses, find supporting and refuting studies, score each source&apos;s credibility and map where
        the evidence agrees and contradicts itself, live into a FalkorDB graph. Tuned for medicine, but the same agents work for economics or any field.
      </p>
      <div className="mt-5 flex flex-col items-center gap-1.5">
        {EXAMPLES.map((e) => (
          <Button key={e} variant="outline" size="sm" className="h-auto max-w-full whitespace-normal rounded-full bg-card py-1 font-normal text-ink-2" onClick={() => ask(e)} disabled={asking}>
            {e}
          </Button>
        ))}
      </div>
      {demos && demos.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {demos.map((d) => (
            <Button key={d.id} size="lg" className="px-4" onClick={() => demo(d.text)}>
              Watch demo: {d.text.length > 40 ? d.text.slice(0, 38) + "…" : d.text}
            </Button>
          ))}
        </div>
      )}
      {health && !health.llm.available && (
        <p className="mt-4 text-[12px] text-ink-3">No LLM configured on the server: live research is off{demos?.length ? "; demos still work" : ""}.</p>
      )}
      <p className="mono mt-4 text-[11px] text-muted-foreground">{asking ? "Reading your question…" : "Press / or Ctrl K to ask"}</p>
    </div>
  ), [interp, research, asking, demos, health, ask, demo]);

  const guard = refusal ?? (state.status === "refused" ? state.guard : null);
  const showError = guard || state.status === "error";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header
        state={state}
        health={health}
        questions={questions}
        busy={asking}
        onAsk={ask}
        onOpenQuestion={open}
        onDemo={demo}
        onStop={stop}
      />

      {showError && (
        <div className="border-b bg-card px-4 py-2.5 md:px-5">
          <Alert variant="destructive" className="border-destructive/40 bg-neg-soft/50">
            {guard ? <ShieldAlert /> : <CircleAlert />}
            <AlertTitle className="flex flex-wrap items-center gap-2 text-foreground">
              <Badge variant="destructive" className="mono rounded-sm text-[10px] uppercase">
                {guard ? "guardrail" : "error"}
              </Badge>
              {guard ? guard.message : state.error}
            </AlertTitle>
            {guard?.checks && (
              <AlertDescription className="mono flex flex-wrap gap-x-3 text-[11px] text-ink-2">
                {guard.checks.map((c) => (
                  <span key={c.name}>
                    {c.passed ? "✓" : "✗"} {c.name}
                  </span>
                ))}
              </AlertDescription>
            )}
          </Alert>
        </div>
      )}

      <Shell
        defaultLayout={defaultLayout}
        left={(collapse) => <Rail state={state} questions={questions} onOpen={open} onFocus={setFocus} onDelete={remove} onCollapse={collapse} />}
        main={
          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1">
              {focus === "compare" && state.hypOrder.length > 1 ? (
                <Compare state={state} onFocus={setFocus} />
              ) : (
                <Graph
                  state={state}
                  focus={focus === "all" || focus === "compare" ? null : focus}
                  selected={selected}
                  onSelect={select}
                  onFocus={setFocus}
                  highlight={refs}
                  trail={trail}
                  onTrail={showTrail}
                  empty={empty}
                />
              )}
            </div>
            <Hyps state={state} focus={focus} onFocus={focusHyp} />
          </div>
        }
        right={(collapse) => (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="h-full min-h-0 gap-0" aria-label="Analysis">
            <div className="flex h-12 shrink-0 items-center border-b pl-3 pr-2">
              <TabsList variant="line" className="h-full flex-1 justify-start rounded-none p-0">
                {TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="flex-none px-3 text-[13.5px]">
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <CollapseButton side="right" onClick={collapse} />
            </div>
            {tab === "chat" ? (
              // The chat scrolls its own messages and keeps the composer pinned below them.
              <TabsContent value="chat" className="min-h-0 overflow-hidden">
                <ChatTab state={state} hk={focus === "all" || focus === "compare" ? null : focus} selected={selected} onPeek={peek} onFocus={focusHyp} onRefs={setRefs} onTrail={showTrail} />
              </TabsContent>
            ) : (
              <ScrollArea key={tab} className="min-h-0 flex-1">
                <TabsContent value="verdict">
                  <VerdictTab state={state} hk={hk} onRefs={setRefs} onSelect={select} />
                </TabsContent>
                <TabsContent value="evidence">
                  <EvidenceTab state={state} hk={hk} onSelect={select} />
                </TabsContent>
                <TabsContent value="queries">
                  <QueriesTab state={state} />
                </TabsContent>
                <TabsContent value="details">
                  <DetailsTab state={state} id={selected} hk={hk} onSelect={select} />
                </TabsContent>
              </ScrollArea>
            )}
          </Tabs>
        )}
      />
    </div>
  );
}
