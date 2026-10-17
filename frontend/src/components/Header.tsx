"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { screen } from "@/lib/api";
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

const SUGGESTIONS = ["Creatine", "Vitamin D", "Minoxidil", "Melatonin", "Omega-3", "Ashwagandha"];

export function Header({
  state,
  health,
  onRun,
  onDemo,
  onStop,
}: {
  state: State;
  health: Health | null;
  onRun: (q: string) => void;
  onDemo: () => void;
  onStop: () => void;
}) {
  const [q, setQ] = useState("");
  const [warn, setWarn] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streaming = state.status === "streaming";

  // Live guardrail pre-check while typing (the server re-checks on submit).
  useEffect(() => {
    if (q.trim().length < 2) {
      setWarn(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await screen(q);
        setWarn(r.ok ? null : r.message);
      } catch {
        setWarn(null);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

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
    if (!q.trim() || warn) return;
    onRun(q.trim());
  };

  return (
    <header className="relative z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-card px-4 py-2.5 md:px-5">
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="text-[17px] font-semibold tracking-[-0.02em]">TruthGraph</span>
      </div>

      <form
        className="relative order-3 w-full md:order-none md:w-auto md:max-w-[560px] md:flex-1"
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
              maxLength={60}
              placeholder="Substance or intervention, e.g. creatine"
              aria-label="Substance or intervention"
              aria-invalid={!!warn}
              className="h-9 bg-surface-2 pl-8 pr-8 text-[14px]"
            />
            <kbd className="mono pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm border px-1.5 text-[10.5px] text-muted-foreground sm:block">/</kbd>
          </div>
          {streaming ? (
            <Button type="button" variant="outline" size="lg" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={!q.trim() || !!warn} className="px-3.5">
              Build graph
            </Button>
          )}
        </div>
        {warn && (
          <div role="alert" className="absolute left-0 top-full z-30 mt-1.5 flex max-w-full items-start gap-2 rounded-lg border border-destructive bg-popover px-3 py-2 text-[12px] text-foreground shadow-[var(--shadow-md)]">
            <Badge variant="destructive" className="mono rounded-sm text-[10px] uppercase">
              guardrail
            </Badge>
            {warn}
          </div>
        )}
        {!q && state.status === "idle" && (
          <div className="mt-1.5 hidden flex-wrap gap-1 md:absolute md:left-0 md:top-full md:flex">
            {SUGGESTIONS.map((s) => (
              <Button key={s} type="button" variant="outline" size="xs" className="rounded-full bg-card font-normal text-ink-2" onClick={() => onRun(s)}>
                {s}
              </Button>
            ))}
          </div>
        )}
      </form>

      <div className="ml-auto flex items-center gap-3">
        <Button variant="outline" onClick={onDemo} disabled={streaming}>
          Load demo
        </Button>
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
