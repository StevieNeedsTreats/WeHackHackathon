"use client";

import { Columns3, LoaderCircle, Network, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { balance, type State } from "@/lib/store";
import { STANCE, TONE } from "./graph/glyphs";
import { BalanceBar } from "./graph/nodes";
import { runIssue } from "./panels/VerdictPanel";
import { Tip } from "./Tip";

export type Focus = string | "all" | "compare";

const STAGE: Record<string, string> = {
  discovery: "Searching",
  stance: "Judging",
  contradictions: "Mapping conflicts",
  verdict: "Writing verdict",
  done: "Done",
};

const TRIGGER =
  "h-auto flex-none rounded-lg border border-transparent px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground " +
  "data-active:border-border data-active:bg-card data-active:text-foreground data-active:shadow-[var(--shadow-sm)] " +
  "dark:data-active:border-border dark:data-active:bg-card";

/** One tab per hypothesis with live status and balance; plus Compare and All. */
export function HypothesisBar({ state, focus, onFocus }: { state: State; focus: Focus; onFocus: (f: Focus) => void }) {
  if (!state.hypOrder.length) return null;
  const streaming = state.status === "streaming";
  return (
    <Tabs value={focus} onValueChange={onFocus} activationMode="manual" className="shrink-0 gap-0 border-b bg-surface-2">
      <ScrollArea className="w-full">
        <TabsList aria-label="Hypotheses" className="w-max gap-1 bg-transparent p-2 group-data-horizontal/tabs:h-auto md:px-3">
          {state.hypOrder.map((k, i) => {
            const h = state.hyps[k];
            const v = state.verdicts[k];
            const b = balance(state, k);
            const running = streaming && !v && !h.reused;
            const issue = runIssue(h, streaming);
            const verdict = v ?? (h.verdict && !running ? { verdict: h.verdict, grade: h.grade, tone: "neutral" as const } : null);
            const tone = TONE[(v?.tone ?? "neutral") as keyof typeof TONE] ?? TONE.neutral;
            return (
              <TabsTrigger key={k} value={k} className={`${TRIGGER} w-[264px] flex-col items-stretch gap-1.5`}>
                <span className="flex h-5 items-center gap-1.5">
                  <span className="mono text-[10.5px] text-muted-foreground">H{i + 1}</span>
                  {verdict ? (
                    <Badge
                      variant="outline"
                      className="mono h-5 rounded-sm border-transparent px-1.5 text-[10.5px] font-medium"
                      style={{ background: tone.soft, color: tone.ink }}
                    >
                      {verdict.verdict}
                      {verdict.grade && <span className="opacity-70">· {verdict.grade}</span>}
                    </Badge>
                  ) : (
                    <span className="mono flex items-center gap-1 text-[10.5px] text-muted-foreground">
                      {running && <LoaderCircle className="size-3 animate-spin" />}
                      {h.reused ? "Reused" : STAGE[h.stage ?? "discovery"]}
                      {h.papers ? ` · ${h.papers} papers` : ""}
                    </span>
                  )}
                  {issue && (
                    <Tip label={<span className="block max-w-[260px]">{issue.body}</span>} side="bottom">
                      <span className="mono ml-auto flex items-center gap-1 text-[10.5px] text-neu-ink">
                        <TriangleAlert className="size-3" />
                        {issue.title === "Partial evidence" ? "partial" : "incomplete"}
                      </span>
                    </Tip>
                  )}
                </span>
                <span className="truncate text-[13px] font-medium text-foreground" title={h.statement}>
                  {h.statement}
                </span>
                <BalanceBar support={b.support} refute={b.refute} mixed={b.mixed} className="h-1.5" />
                <span className="mono tabular flex justify-between text-[10px]">
                  <span style={{ color: STANCE.supports.ink }}>{Math.round(b.support * 100)}% supports</span>
                  <span style={{ color: STANCE.refutes.ink }}>{Math.round(b.refute * 100)}% refutes</span>
                </span>
              </TabsTrigger>
            );
          })}
          <Separator orientation="vertical" className="mx-1 h-12 self-center" />
          {state.hypOrder.length > 1 && (
            <TabsTrigger value="compare" className={`${TRIGGER} flex-col gap-1 self-stretch px-4`}>
              <Columns3 />
              <span className="text-[12px] font-medium">Compare</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="all" className={`${TRIGGER} flex-col gap-1 self-stretch px-4`}>
            <Network />
            <span className="text-[12px] font-medium">All</span>
          </TabsTrigger>
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Tabs>
  );
}
