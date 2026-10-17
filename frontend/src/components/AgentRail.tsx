"use client";

import { CircleCheck, CircleDashed, CircleX, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AGENT_ORDER, type AgentState, type State } from "@/lib/store";
import type { QuestionSummary } from "@/lib/types";
import { SectionLabel, Tip } from "./Tip";

function StatusIcon({ s }: { s: AgentState["status"] }) {
  const p = { size: 16, strokeWidth: 1.75 };
  if (s === "running") return <LoaderCircle {...p} className="animate-spin text-foreground" aria-label="running" />;
  if (s === "done") return <CircleCheck {...p} className="fill-foreground text-card" aria-label="done" />;
  if (s === "error") return <CircleX {...p} className="fill-destructive text-card" aria-label="error" />;
  return <CircleDashed {...p} className="text-ink-4" aria-label="queued" />;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

export function HChip({ n, onClick }: { n: number | undefined; onClick?: () => void }) {
  if (!n) return null;
  return (
    <button type="button" onClick={onClick} className="mono shrink-0 rounded-sm border border-line-2 bg-surface px-1 text-[9.5px] leading-[14px] text-ink-2 hover:border-ink-3">
      H{n}
    </button>
  );
}

export function AgentRail({
  state,
  questions,
  onOpen,
  onFocus,
}: {
  state: State;
  questions: QuestionSummary[];
  onOpen: (id: string, key?: string) => void;
  onFocus: (key: string) => void;
}) {
  const hNum = Object.fromEntries(state.hypOrder.map((k, i) => [k, i + 1]));
  const total = Object.values(state.usage).reduce(
    (a, u) => ({ input_tokens: a.input_tokens + u.input_tokens, output_tokens: a.output_tokens + u.output_tokens, cost_usd: a.cost_usd + u.cost_usd }),
    { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  );
  const engine = state.engine === "replay" ? "recorded run" : state.engine;

  return (
    <aside className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex items-baseline justify-between px-4 pb-2 pt-4">
          <SectionLabel>Agents</SectionLabel>
          {state.status !== "idle" && engine && <span className="mono text-[10px] text-muted-foreground">{engine}</span>}
        </div>
        <ol className="relative px-4">
          {AGENT_ORDER.map((a, i) => {
            const ag = state.agents[a.id];
            const u = state.usage[a.id];
            const pct = ag.total ? Math.min(100, ((ag.done ?? 0) / ag.total) * 100) : 0;
            return (
              <li key={a.id} className="relative flex gap-3 pb-4">
                {i < AGENT_ORDER.length - 1 && (
                  <span aria-hidden className="absolute left-[7.5px] top-[20px] h-[calc(100%-18px)] w-px" style={{ background: ag.status === "done" ? "var(--ink-3)" : "var(--line)" }} />
                )}
                <div className="relative z-[1] mt-[1px] rounded-full bg-background">
                  <StatusIcon s={ag.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-[13px] font-medium ${ag.status === "queued" ? "text-muted-foreground" : "text-foreground"}`}>{a.name}</span>
                    <span className="mono tabular flex shrink-0 gap-1.5 text-[10.5px] text-muted-foreground">
                      {u && u.input_tokens + u.output_tokens > 0 && (
                        <Tip label={`${u.calls} LLM call${u.calls === 1 ? "" : "s"} · ${u.input_tokens.toLocaleString()} in / ${u.output_tokens.toLocaleString()} out`}>
                          <span>{fmtTok(u.input_tokens + u.output_tokens)} tok</span>
                        </Tip>
                      )}
                      {ag.status !== "queued" && ag.ms > 0 && <span>{fmtMs(ag.ms)}</span>}
                    </span>
                  </div>
                  <div className={`mt-0.5 flex items-start gap-1 text-[11.5px] leading-snug ${ag.detail ? "text-ink-2" : "text-muted-foreground"}`}>
                    {ag.hypothesis && <HChip n={hNum[ag.hypothesis]} onClick={() => onFocus(ag.hypothesis!)} />}
                    <span className="min-w-0">{ag.detail || a.role}</span>
                  </div>
                  {ag.status === "running" && ag.total ? <Progress value={pct} className="mt-1.5 h-[3px]" aria-label={`${a.name} progress`} /> : null}
                </div>
              </li>
            );
          })}
        </ol>

        {total.input_tokens + total.output_tokens > 0 && (
          <div className="mono mx-4 mb-3 flex justify-between rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[10.5px] text-ink-2">
            <span>{fmtTok(total.input_tokens + total.output_tokens)} tokens</span>
            {total.cost_usd > 0 && <span>${total.cost_usd.toFixed(3)}</span>}
          </div>
        )}

        {state.steps.length > 0 && (
          <Card size="sm" className="mx-4 mb-4 gap-1.5 bg-surface-2 px-3 shadow-none">
            <SectionLabel className="text-[10.5px]">Activity</SectionLabel>
            <ul className="mono space-y-1 text-[10.5px] leading-snug text-ink-2">
              {state.steps.slice(-12).map((l, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="tabular w-[34px] shrink-0 text-right text-ink-4">{fmtMs(l.t ?? 0)}</span>
                  {l.hypothesis && <HChip n={hNum[l.hypothesis]} />}
                  <span className={`min-w-0 truncate ${l.kind === "status" ? "" : "text-ink-3"}`} title={l.text}>
                    {l.kind === "tool" || l.kind === "search" ? "→ " : ""}
                    {l.text}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </ScrollArea>

      <Separator />
      <div className="max-h-[38%] overflow-y-auto px-3 py-3">
        <SectionLabel className="mb-1.5 px-1">Researched questions</SectionLabel>
        {questions.length === 0 ? (
          <p className="px-1 text-[12px] text-muted-foreground">Nothing researched yet.</p>
        ) : (
          <ul className="space-y-1">
            {questions.map((q) => (
              <li key={q.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpen(q.id)}
                  data-active={state.question?.id === q.id || undefined}
                  className="h-auto w-full justify-start py-1 text-left font-normal text-ink-2 data-active:bg-muted data-active:font-medium data-active:text-foreground"
                >
                  <span className="line-clamp-2 min-w-0 whitespace-normal">{q.text}</span>
                  {q.id.startsWith("demo-") ? (
                    <Badge variant="secondary" className="ml-auto h-4 shrink-0 rounded-sm px-1 text-[9.5px] font-normal">
                      demo
                    </Badge>
                  ) : q.running ? (
                    <Badge variant="secondary" className="ml-auto h-4 shrink-0 rounded-sm px-1 text-[9.5px] font-normal">
                      running
                    </Badge>
                  ) : q.complete === false ? (
                    <Badge variant="outline" className="ml-auto h-4 shrink-0 rounded-sm border-neu px-1 text-[9.5px] font-normal text-neu-ink" title="Didn't finish; open it to resume">
                      incomplete
                    </Badge>
                  ) : null}
                </Button>
                <ul className="ml-3 border-l border-line pl-2">
                  {q.hypotheses.map((h) => (
                    <li key={h.key}>
                      <button type="button" onClick={() => onOpen(q.id, h.key)} className="flex w-full items-center gap-1.5 py-0.5 text-left text-[11px] text-ink-3 hover:text-ink">
                        <span className="min-w-0 flex-1 truncate">{h.statement}</span>
                        {h.verdict && <span className="mono shrink-0 text-[9.5px]">{h.grade}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
