"use client";

import { CircleAlert, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AgentRail } from "@/components/AgentRail";
import { CompareView } from "@/components/CompareView";
import GraphCanvas from "@/components/graph/GraphCanvas";
import { EXAMPLES, Header } from "@/components/Header";
import { HypothesisBar, type Focus } from "@/components/HypothesisBar";
import { InterpretationCard } from "@/components/InterpretationCard";
import { DetailsPanel } from "@/components/panels/DetailsPanel";
import { EvidencePanel } from "@/components/panels/EvidencePanel";
import { QueriesPanel } from "@/components/panels/QueriesPanel";
import { VerdictPanel } from "@/components/panels/VerdictPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteQuestion, getHealth, getQuestions, interpret, type Edits } from "@/lib/api";
import { useResearch } from "@/lib/store";
import type { Guardrail, Health, Interpretation, QuestionSummary } from "@/lib/types";

type Tab = "verdict" | "evidence" | "queries" | "details";
const TABS: { id: Tab; label: string }[] = [
  { id: "verdict", label: "Verdict" },
  { id: "evidence", label: "Evidence" },
  { id: "queries", label: "Queries" },
  { id: "details", label: "Details" },
];

export default function Home() {
  const { state, run, load, detach, stop, reset } = useResearch();
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
  useEffect(() => {
    if (!nHyps) return;
    if (pendingFocus && state.hyps[pendingFocus]) {
      setFocus(pendingFocus);
      setPendingFocus(null);
    } else setFocus(state.question?.compare && nHyps > 1 ? "compare" : state.hypOrder[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new question arrives
  }, [qid, nHyps > 0]);

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

  const select = (id: string | null) => {
    setSelected(id);
    if (id) setTab("details");
  };
  const ask = async (text: string) => {
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
  };
  const research = (edits: Edits) => {
    if (!interp?.question) return;
    const text = interp.question.text;
    setInterp(null);
    setSelected(null);
    setTab("verdict");
    run(text, "live", edits);
  };
  const demo = (text: string) => {
    setInterp(null);
    setRefusal(null);
    setSelected(null);
    setTab("verdict");
    run(text, "demo");
  };
  const open = (id: string, key?: string) => {
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
  };

  const remove = async (id: string) => {
    try {
      await deleteQuestion(id);
    } catch (e) {
      setRefusal({ ok: false, code: "error", message: `Couldn't delete: ${(e as Error).message}` });
      return;
    }
    if (state.question?.id === id) {
      detach();
      reset();
      setFocus("all");
      setSelected(null);
      window.history.replaceState(null, "", window.location.pathname);
    }
    refresh();
  };

  const demos = health?.demos ?? [];
  const empty = interp ? (
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
      {demos.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {demos.map((d) => (
            <Button key={d.id} size="lg" className="px-4" onClick={() => demo(d.text)}>
              Watch demo: {d.text.length > 40 ? d.text.slice(0, 38) + "…" : d.text}
            </Button>
          ))}
        </div>
      )}
      {health && !health.llm.available && (
        <p className="mt-4 text-[12px] text-ink-3">No LLM configured on the server: live research is off{demos.length ? "; demos still work" : ""}.</p>
      )}
      <p className="mono mt-4 text-[11px] text-muted-foreground">{asking ? "Reading your question…" : "Press / to ask"}</p>
    </div>
  );

  const guard = refusal ?? (state.status === "refused" ? state.guard : null);
  const showError = guard || state.status === "error";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header state={state} health={health} busy={asking} onAsk={ask} onDemo={demo} onStop={stop} />
      <HypothesisBar
        state={state}
        focus={focus}
        onFocus={(f) => {
          setFocus(f);
          setSelected(null);
        }}
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[272px_minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        <div className="order-3 border-t bg-background lg:order-none lg:min-h-0 lg:border-r lg:border-t-0">
          <AgentRail state={state} questions={questions} onOpen={open} onFocus={setFocus} onDelete={remove} />
        </div>

        <main className="order-1 h-[64vh] min-h-[420px] lg:order-none lg:h-auto lg:min-h-0" aria-label="Evidence graph">
          {focus === "compare" && state.hypOrder.length > 1 ? (
            <CompareView state={state} onFocus={setFocus} />
          ) : (
            <GraphCanvas
              state={state}
              focus={focus === "all" || focus === "compare" ? null : focus}
              selected={selected}
              onSelect={select}
              onFocus={setFocus}
              highlight={refs}
              empty={empty}
            />
          )}
        </main>

        <aside className="order-2 flex h-[72vh] min-h-0 flex-col border-t bg-surface-2 lg:order-none lg:h-auto lg:border-l lg:border-t-0" aria-label="Analysis">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
            <TabsList variant="line" className="h-10 w-full shrink-0 justify-start rounded-none border-b px-3">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="flex-none px-2.5 text-[13px]">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <ScrollArea key={tab} className="min-h-0 flex-1">
              <TabsContent value="verdict">
                <VerdictPanel state={state} hk={hk} onRefs={setRefs} onSelect={select} />
              </TabsContent>
              <TabsContent value="evidence">
                <EvidencePanel state={state} hk={hk} onSelect={select} />
              </TabsContent>
              <TabsContent value="queries">
                <QueriesPanel state={state} />
              </TabsContent>
              <TabsContent value="details">
                <DetailsPanel state={state} id={selected} hk={hk} onSelect={select} />
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
