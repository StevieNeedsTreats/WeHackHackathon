"use client";

import { TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Edits } from "@/lib/api";
import type { Interpretation } from "@/lib/types";
import { SectionLabel } from "./Tip";

function Chip({ role, value }: { role: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-surface px-2 py-0.5 text-[12px]">
      <span className="mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">{role}</span>
      <span className="text-ink">{value}</span>
    </span>
  );
}

/** What the Intake agent understood. Nothing runs until the user confirms. */
export function InterpretationCard({
  interp,
  onRun,
  onCancel,
}: {
  interp: Interpretation;
  onRun: (edits: Edits) => void;
  onCancel: () => void;
}) {
  const q = interp.question!;
  const d = interp.domain!;
  const [keep, setKeep] = useState<Record<string, boolean>>(() => Object.fromEntries(q.hypotheses.map((h) => [h.key, true])));
  const [pop, setPop] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const kept = q.hypotheses.filter((h) => keep[h.key]);

  const run = () => {
    const edits: Edits = {};
    if (kept.length !== q.hypotheses.length) edits.keep = kept.map((h) => h.key);
    const changed = Object.fromEntries(Object.entries(pop).filter(([k, v]) => v !== (q.hypotheses.find((h) => h.key === k)?.population?.name ?? "")));
    if (Object.keys(changed).length) edits.population = changed;
    if (fresh) edits.fresh = true;
    onRun(edits);
  };

  return (
    <Card className="pointer-events-auto w-[min(640px,calc(100vw-2rem))] gap-3 p-5 shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Here&apos;s what we&apos;ll test</SectionLabel>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Domain: <span className="text-ink-2">{d.name}</span>. Untick anything you don&apos;t want, or change who it applies to.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Cancel" onClick={onCancel}>
          <X />
        </Button>
      </div>

      {q.corrections && q.corrections.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[11.5px] text-ink-3">
          Corrected:
          {q.corrections.map((c) => (
            <Badge key={c} variant="secondary" className="mono rounded-sm font-normal">
              {c}
            </Badge>
          ))}
        </div>
      )}

      <ol className="space-y-2">
        {q.hypotheses.map((h, i) => (
          <li key={h.key} className={`rounded-lg border px-3 py-2.5 ${keep[h.key] ? "border-line-2 bg-surface" : "border-line bg-surface-2 opacity-60"}`}>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={keep[h.key]}
                onChange={(e) => setKeep((k) => ({ ...k, [h.key]: e.target.checked }))}
                className="mt-1 accent-[var(--ink)]"
                aria-label={`Include hypothesis ${i + 1}`}
              />
              <span className="min-w-0 flex-1">
                <span className="mono mr-1.5 text-[10.5px] text-ink-3">H{i + 1}</span>
                <span className="text-[14px] font-medium text-ink">{h.statement}</span>
              </span>
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
              <Chip role={d.subject} value={h.subject.name} />
              <Chip role={d.outcome} value={h.outcome.name} />
              {editing === h.key ? (
                <Input
                  autoFocus
                  defaultValue={pop[h.key] ?? h.population?.name ?? ""}
                  placeholder="anyone"
                  className="h-6 w-[180px] text-[12px]"
                  onBlur={(e) => {
                    setPop((p) => ({ ...p, [h.key]: e.target.value }));
                    setEditing(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  disabled={interp.question?.id.startsWith("demo-")}
                />
              ) : (
                <button type="button" onClick={() => setEditing(h.key)} className="rounded-full hover:ring-1 hover:ring-ink-3" title="Change who this applies to">
                  <Chip role={d.population} value={(pop[h.key] ?? h.population?.name) || "anyone"} />
                </button>
              )}
              {h.assumed && h.assumed.length > 0 && <span className="text-[11px] text-ink-3">assumed: {h.assumed.join(", ")}</span>}
            </div>
          </li>
        ))}
      </ol>

      {interp.notice && (
        <Alert className="border-neu/50 bg-neu-soft/60">
          <TriangleAlert />
          <AlertDescription className="text-[12px] text-ink-2">{interp.notice}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} className="accent-[var(--ink)]" />
          Research again even if done recently
        </label>
        <Button size="lg" onClick={run} disabled={!kept.length} className="px-4">
          Research {kept.length} hypothes{kept.length === 1 ? "is" : "es"}
        </Button>
      </div>
    </Card>
  );
}
