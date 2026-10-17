"use client";

import { CircleCheck, CircleDashed, CircleX, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AGENT_ORDER, type State } from "@/lib/store";
import type { AgentState, SubstanceSummary } from "@/lib/types";
import { SectionLabel } from "./Tip";

function StatusIcon({ s }: { s: AgentState["status"] }) {
  const p = { size: 16, strokeWidth: 1.75 };
  if (s === "running") return <LoaderCircle {...p} className="animate-spin text-foreground" aria-label="running" />;
  if (s === "done") return <CircleCheck {...p} className="fill-foreground text-card" aria-label="done" />;
  if (s === "error") return <CircleX {...p} className="fill-destructive text-card" aria-label="error" />;
  return <CircleDashed {...p} className="text-ink-4" aria-label="queued" />;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export function AgentRail({ state, substances, onOpen }: { state: State; substances: SubstanceSummary[]; onOpen: (key: string) => void }) {
  return (
    <aside className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex items-baseline justify-between px-4 pb-2 pt-4">
          <SectionLabel>Agents</SectionLabel>
          {state.status !== "idle" && (
            <span className="mono text-[10px] text-muted-foreground">{state.engine === "claude" ? "claude-haiku-5-5" : "rule extractor"}</span>
          )}
        </div>
        <ol className="relative px-4">
          {AGENT_ORDER.map((a, i) => {
            const ag = state.agents[a.id];
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
                    {ag.status !== "queued" && ag.ms > 0 && <span className="mono tabular shrink-0 text-[10.5px] text-muted-foreground">{fmtMs(ag.ms)}</span>}
                  </div>
                  <div className={`mt-0.5 text-[11.5px] leading-snug ${ag.detail ? "text-ink-2" : "text-muted-foreground"}`}>{ag.detail || a.role}</div>
                  {ag.status === "running" && ag.total ? <Progress value={pct} className="mt-1.5 h-[3px]" aria-label={`${a.name} progress`} /> : null}
                </div>
              </li>
            );
          })}
        </ol>

        {state.log.length > 0 && (
          <Card size="sm" className="mx-4 mb-4 gap-1.5 bg-surface-2 px-3 shadow-none">
            <SectionLabel className="text-[10.5px]">Activity</SectionLabel>
            <ul className="mono space-y-1 text-[10.5px] leading-snug text-ink-2">
              {state.log.slice(-7).map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="tabular w-[38px] shrink-0 text-right text-ink-4">{fmtMs(l.t)}</span>
                  <span className="truncate">{l.detail}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </ScrollArea>

      <Separator />
      <div className="px-3 py-3">
        <SectionLabel className="mb-1.5 px-1">In the graph</SectionLabel>
        {substances.length === 0 ? (
          <p className="px-1 text-[12px] text-muted-foreground">Nothing built yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {substances.map((s) => (
              <li key={s.key}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpen(s.key)}
                  data-active={state.key === s.key || undefined}
                  className="w-full justify-between font-normal text-ink-2 data-active:bg-muted data-active:font-medium data-active:text-foreground"
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    {s.name}
                    {s.key.endsWith("-demo") && (
                      <Badge variant="secondary" className="h-4 rounded-sm px-1 text-[9.5px] font-normal">
                        demo
                      </Badge>
                    )}
                  </span>
                  <span className="mono tabular shrink-0 text-[10.5px] text-muted-foreground">
                    {s.papers}p · {s.claims}c
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
