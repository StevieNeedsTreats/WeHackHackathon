"use client";

import { Link2, Search, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { isTyping } from "@/lib/keys";
import { notify } from "@/lib/notify";
import type { State } from "@/lib/store";
import type { Health, QuestionSummary } from "@/lib/types";
import { AskPalette } from "./AskPalette";
import { Logo } from "./Logo";
import { ThemeToggle } from "./theme";
import { Tip } from "./Tip";

export const EXAMPLES = [
  "effects of minoxidil on hair loss, and side effects of minoxidil in pregnant women",
  "creatine on intelligence vs muscle gain",
  "Does raising the minimum wage reduce employment?",
  "what happens if a pregnant woman takes melatonin",
];

/** Opens the ask palette from anywhere: ⌘K / Ctrl+K always, / when not typing. */
export function useAskShortcut() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

/** ⌘ on Apple platforms, Ctrl elsewhere. Starts as Ctrl so server and client render the same. */
function useModKey() {
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setMod("⌘");
  }, []);
  return mod;
}

/** Copy the deep link to the open question (and hypothesis, already in the address bar once it loads). */
async function share(qid: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("q") !== qid) {
    url.search = "";
    url.searchParams.set("q", qid);
  }
  try {
    await navigator.clipboard.writeText(url.toString());
    notify("info", "Link copied", { description: "Anyone with the link and the password can open this question." });
  } catch {
    notify("error", "Couldn't copy the link", { description: url.toString() });
  }
}

export function Header({
  state,
  health,
  questions,
  busy,
  onAsk,
  onOpenQuestion,
  onDemo,
  onStop,
}: {
  state: State;
  health: Health | null;
  questions: QuestionSummary[];
  busy: boolean;
  onAsk: (q: string) => void;
  onOpenQuestion: (id: string) => void;
  onDemo: (q: string) => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useAskShortcut();
  const mod = useModKey();
  const streaming = state.status === "streaming";
  const demos = health?.demos ?? [];
  const current = state.question?.text ?? "";

  return (
    <header className="relative z-20 grid h-14 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-3 md:px-4">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-2">
          <Logo size={24} />
          <span className="hidden text-[16px] font-semibold tracking-[-0.02em] sm:inline">TruthGraph</span>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-center gap-2">
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          disabled={busy}
          aria-label="Ask about a claim"
          className="h-9 w-full max-w-[560px] justify-start gap-2 bg-surface-2 px-3 font-normal text-muted-foreground shadow-none hover:bg-muted/60"
        >
          <Search className="size-4 shrink-0" />
          <span className={`min-w-0 flex-1 truncate text-left text-[13.5px] ${current ? "text-foreground" : ""}`}>
            {busy ? "Reading your question…" : current || "Ask about any claim…"}
          </span>
          <KbdGroup className="hidden sm:inline-flex">
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        {streaming && (
          <Button variant="outline" className="h-9 shrink-0" onClick={onStop}>
            <Square className="fill-current" />
            Stop
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Tip label={health?.falkordb ? `Connected to graph “${health.graph}”` : "FalkorDB unreachable"} side="bottom">
          <Badge variant="outline" className="mono hidden h-7 gap-2 rounded-md px-2.5 font-normal text-ink-2 xl:inline-flex">
            <span className={`size-2 rounded-full ${health?.falkordb ? "bg-ok" : "bg-destructive"}`} />
            FalkorDB
            {health && (
              <span className="tabular text-muted-foreground">
                {health.nodes.toLocaleString()} nodes · {health.edges.toLocaleString()} edges
              </span>
            )}
          </Badge>
        </Tip>
        {state.question && (
          <Tip label="Copy a link to this question" side="bottom">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-ink-2" onClick={() => share(state.question!.id)}>
              <Link2 />
              <span className="hidden md:inline">Share</span>
            </Button>
          </Tip>
        )}
        <ThemeToggle />
      </div>

      <AskPalette
        open={open}
        onOpenChange={setOpen}
        initial={current}
        examples={EXAMPLES}
        questions={questions}
        demos={demos}
        onAsk={onAsk}
        onOpenQuestion={onOpenQuestion}
        onDemo={onDemo}
      />
    </header>
  );
}
