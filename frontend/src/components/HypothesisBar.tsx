"use client";

import { Columns3, LoaderCircle, Network, TriangleAlert } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { balance, type State } from "@/lib/store";
import { TONE } from "./graph/glyphs";
import { BalanceBar } from "./graph/nodes";
import { runIssue } from "./panels/VerdictPanel";
import { Tip } from "./Tip";

export type Focus = string | "all" | "compare";

const STAGE: Record<string, string> = {
  discovery: "Searching",
  stance: "Judging",
  contradictions: "Mapping",
  verdict: "Writing",
  done: "Done",
};

const TRIGGER =
  "h-8 flex-none gap-2 rounded-lg border border-transparent px-2.5 text-[12.5px] font-normal text-ink-3 hover:bg-surface-3 hover:text-ink " +
  "data-active:border-line data-active:bg-card data-active:text-ink data-active:shadow-[var(--shadow-sm)] dark:data-active:border-line dark:data-active:bg-card";

/** A slim tab strip under the graph: one tab per hypothesis, plus Compare and All. */
export function HypothesisBar({ state, focus, onFocus }: { state: State; focus: Focus; onFocus: (f: Focus) => void }) {
  if (!state.hypOrder.length) return null;
  const streaming = state.status === "streaming";
  return (
    <Tabs value={focus} onValueChange={onFocus} activationMode="manual" className="shrink-0 gap-0 border-t bg-card">
      <ScrollArea className="w-full">
        <TabsList aria-label="Hypotheses" className="w-max gap-1 bg-transparent px-2 py-1.5 group-data-horizontal/tabs:h-auto">
          {state.hypOrder.map((k, i) => {
            const h = state.hyps[k];
            const v = state.verdicts[k];
            const b = balance(state, k);
            const running = streaming && !v && !h.reused;
            const issue = runIssue(h, streaming);
            const label = v ? `${v.verdict}, ${v.grade}` : h.verdict && !running ? `${h.verdict}, ${h.grade}` : null;
            const tone = (v ? TONE[v.tone] : null) ?? TONE.neutral;
            return (
              <Tip key={k} label={<span className="block max-w-[320px]">{h.statement}{issue ? ` — ${issue.body}` : ""}</span>} side="top">
                <TabsTrigger value={k} className={TRIGGER}>
                  <span className="text-[12px] font-medium text-ink-3">H{i + 1}</span>
                  {label ? (
                    <span className="size-[7px] shrink-0 rotate-45 rounded-[1px]" style={{ background: tone.color }} aria-hidden />
                  ) : (
                    running && <LoaderCircle className="size-3 animate-spin" />
                  )}
                  <span className="shrink-0 text-[12px] font-medium" style={label ? { color: tone.ink } : undefined}>
                    {label ?? (h.reused ? "Reused" : STAGE[h.stage ?? "discovery"])}
                  </span>
                  <span className="max-w-[200px] truncate">{h.statement}</span>
                  <BalanceBar support={b.support} refute={b.refute} mixed={b.mixed} className="h-1 w-8 shrink-0" />
                  {issue && <TriangleAlert className="size-3 text-neu-ink" aria-label={issue.title} />}
                </TabsTrigger>
              </Tip>
            );
          })}
          <Separator orientation="vertical" className="mx-1 h-4 self-center" />
          {state.hypOrder.length > 1 && (
            <TabsTrigger value="compare" className={TRIGGER}>
              <Columns3 className="size-3.5" />
              Compare
            </TabsTrigger>
          )}
          <TabsTrigger value="all" className={TRIGGER}>
            <Network className="size-3.5" />
            All
          </TabsTrigger>
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Tabs>
  );
}
