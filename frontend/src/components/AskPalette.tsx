"use client";

import { CornerDownLeft, History, PlayCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { QuestionSummary } from "@/lib/types";

/** ⌘K palette: type a claim and press Enter, or pick an example, a past question or a demo. */
export function AskPalette({
  open,
  onOpenChange,
  initial,
  examples,
  questions,
  demos,
  onAsk,
  onOpenQuestion,
  onDemo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: string;
  examples: string[];
  questions: QuestionSummary[];
  demos: { id: string; text: string }[];
  onAsk: (q: string) => void;
  onOpenQuestion: (id: string) => void;
  onDemo: (q: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[640px]" showCloseButton={false}>
        <DialogTitle className="sr-only">Ask about a claim</DialogTitle>
        <DialogDescription className="sr-only">Type a question and press Enter, or pick a suggestion.</DialogDescription>
        {/* Remount per opening so the input starts from the current question. */}
        {open && <Body {...{ initial, examples, questions, demos, onAsk, onOpenQuestion, onDemo }} done={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  initial,
  examples,
  questions,
  demos,
  onAsk,
  onOpenQuestion,
  onDemo,
  done,
}: Omit<React.ComponentProps<typeof AskPalette>, "open" | "onOpenChange"> & { done: () => void }) {
  const [q, setQ] = useState(initial);
  const text = q.trim();
  const run = (f: () => void) => {
    done();
    f();
  };
  return (
    <Command loop className="rounded-none">
      <CommandInput value={q} onValueChange={setQ} placeholder="Ask about any claim, e.g. does creatine improve memory?" maxLength={400} />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>Type at least 3 characters to research your own question.</CommandEmpty>
        {text.length >= 3 && (
          <CommandGroup>
            <CommandItem value={`ask ${text}`} forceMount onSelect={() => run(() => onAsk(text))}>
              <Sparkles />
              <span className="truncate">
                Research <span className="font-medium">“{text}”</span>
              </span>
              <CommandShortcut>
                <CornerDownLeft className="size-3.5" />
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Examples">
          {examples.map((e) => (
            <CommandItem key={e} value={e} onSelect={() => run(() => onAsk(e))}>
              <Sparkles className="text-muted-foreground" />
              <span className="truncate">{e}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {questions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Researched questions">
              {questions.slice(0, 12).map((x) => (
                <CommandItem key={x.id} value={`${x.text} ${x.id}`} onSelect={() => run(() => onOpenQuestion(x.id))}>
                  <History className="text-muted-foreground" />
                  <span className="truncate">{x.text}</span>
                  <CommandShortcut className="tabular">{x.hypotheses.length} hyp</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {demos.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Demos">
              {demos.map((d) => (
                <CommandItem key={d.id} value={`demo ${d.text}`} onSelect={() => run(() => onDemo(d.text))}>
                  <PlayCircle className="text-muted-foreground" />
                  <span className="truncate">Replay: {d.text}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );
}
