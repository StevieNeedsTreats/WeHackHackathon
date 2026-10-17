"use client";

import { RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { State } from "@/lib/store";
import type { Health } from "@/lib/types";
import { Tip } from "./Tip";

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="4.5" r="2.6" fill="var(--ink)" />
      <circle cx="5" cy="17" r="2.6" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      <circle cx="19" cy="17" r="2.6" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      <path d="M10.8 6.8L6.3 14.6M13.2 6.8l4.5 7.8" stroke="var(--ink)" strokeWidth="1.6" />
      <path d="M7.6 17h8.8" stroke="var(--neg)" strokeWidth="1.6" strokeDasharray="2.2 1.8" />
    </svg>
  );
}

export const EXAMPLES = [
  "effects of minoxidil on hair loss, and side effects of minoxidil in pregnant women",
  "creatine on intelligence vs muscle gain",
  "Does raising the minimum wage reduce employment?",
  "what happens if a pregnant woman takes melatonin",
];

export function Header({
  state,
  health,
  busy,
  onAsk,
  onDemo,
  onStop,
  onRetry,
}: {
  state: State;
  health: Health | null;
  busy: boolean;
  onAsk: (q: string) => void;
  onDemo: (q: string) => void;
  onStop: () => void;
  onRetry?: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const streaming = state.status === "streaming";
  const demo = health?.demos?.[0];

  useEffect(() => {
    if (state.question?.text && state.question.text !== q) setQ(state.question.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when a new question loads
  }, [state.question?.text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    if (q.trim().length >= 3) onAsk(q.trim());
  };

  return (
    <header className="relative z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-card px-4 py-2.5 md:px-5">
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="text-[17px] font-semibold tracking-[-0.02em]">TruthGraph</span>
      </div>

      <form
        className="relative order-3 w-full md:order-none md:w-auto md:max-w-[720px] md:flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={400}
              placeholder="Ask about any claim, e.g. does creatine improve memory?"
              aria-label="Question or claim"
              className="h-9 bg-surface-2 pl-8 pr-8 text-[14px]"
            />
            <kbd className="mono pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm border px-1.5 text-[10.5px] text-muted-foreground sm:block">/</kbd>
          </div>
          {streaming ? (
            <Button type="button" variant="outline" size="lg" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <>
              <Button type="submit" size="lg" disabled={q.trim().length < 3 || busy} className="px-3.5">
                {busy ? "Reading…" : "Interpret"}
              </Button>
              {onRetry && (
                <Tip label="Run every agent again for this question, ignoring cached research" side="bottom">
                  <Button type="button" variant="outline" size="lg" onClick={onRetry} aria-label="Retry">
                    <RotateCcw />
                    Retry
                  </Button>
                </Tip>
              )}
            </>
          )}
        </div>
      </form>

      <div className="ml-auto flex items-center gap-3">
        {demo && (
          <Tip label={`Replays a recorded run: “${demo.text}”`} side="bottom">
            <Button variant="outline" onClick={() => onDemo(demo.text)} disabled={streaming}>
              Load demo
            </Button>
          </Tip>
        )}
        <Tip label={health?.falkordb ? `Connected to graph “${health.graph}”` : "FalkorDB unreachable"} side="bottom">
          <Badge variant="outline" className="mono hidden h-7 gap-2 rounded-md px-2.5 font-normal text-ink-2 lg:inline-flex">
            <span className={`size-2 rounded-full ${health?.falkordb ? "bg-ok" : "bg-destructive"}`} />
            FalkorDB
            {health && (
              <span className="tabular text-muted-foreground">
                {health.nodes.toLocaleString()} nodes · {health.edges.toLocaleString()} edges
              </span>
            )}
          </Badge>
        </Tip>
      </div>
    </header>
  );
}
