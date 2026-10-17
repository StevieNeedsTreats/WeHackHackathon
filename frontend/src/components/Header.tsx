"use client";

import { useEffect, useRef, useState } from "react";
import { screen } from "@/lib/api";
import type { State } from "@/lib/store";
import type { Health } from "@/lib/types";

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

  const submit = (v = q) => {
    if (!v.trim() || warn) return;
    onRun(v.trim());
  };

  return (
    <header className="relative z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface px-4 py-2.5 md:px-5">
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="text-[17px] font-semibold tracking-[-0.02em]">TruthGraph</span>
      </div>

      <form
        className="relative order-3 w-full md:order-none md:w-auto md:flex-1 md:max-w-[560px]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={`flex items-center rounded-[8px] border bg-surface-2 transition-colors focus-within:border-ink-3 focus-within:bg-surface ${warn ? "border-neg" : "border-line-2"}`}>
          <svg className="ml-3 shrink-0 text-ink-3" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={60}
            placeholder="Substance or intervention — e.g. creatine, vitamin D"
            aria-label="Substance or intervention"
            aria-invalid={!!warn}
            className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="mono mr-2 hidden rounded-[4px] border border-line-2 px-1.5 text-[10.5px] text-ink-3 sm:block">/</kbd>
          {streaming ? (
            <button type="button" onClick={onStop} className="m-1 rounded-[6px] border border-line-2 bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-3">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!q.trim() || !!warn} className="m-1 rounded-[6px] bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-35">
              Build graph
            </button>
          )}
        </div>
        {warn && (
          <div role="alert" className="absolute left-0 top-full z-30 mt-1.5 flex max-w-full items-start gap-2 rounded-[7px] border border-neg bg-surface px-3 py-2 text-[12px] text-ink shadow-[var(--shadow-md)]">
            <span className="mono shrink-0 rounded-[3px] bg-neg-soft px-1 text-[10px] uppercase tracking-wide text-neg-ink">guardrail</span>
            {warn}
          </div>
        )}
        {!q && state.status === "idle" && (
          <div className="mt-1.5 hidden flex-wrap gap-1 md:absolute md:left-0 md:top-full md:flex">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => onRun(s)} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:border-ink-3 hover:text-ink">
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="ml-auto flex items-center gap-3">
        <button onClick={onDemo} disabled={streaming} className="rounded-[7px] border border-line-2 px-3 py-1.5 text-[13px] text-ink hover:bg-surface-3 disabled:opacity-40">
          Load demo
        </button>
        <div className="hidden items-center gap-2 lg:flex" title={health?.falkordb ? "Connected to FalkorDB" : "FalkorDB unreachable"}>
          <span className={`h-2 w-2 rounded-full ${health?.falkordb ? "bg-ok" : "bg-neg"}`} />
          <span className="mono text-[11.5px] text-ink-2">
            FalkorDB{health ? <span className="tabular text-ink-3"> · {health.nodes.toLocaleString()} nodes · {health.edges.toLocaleString()} edges</span> : null}
          </span>
        </div>
      </div>
    </header>
  );
}
