"use client";

import { Card } from "@/components/ui/card";
import type { State } from "@/lib/store";
import { StanceGlyph } from "./glyphs";

/** What a reader wants before clicking a paper: what it is, how strong it is, who paid for it, what it found. */
export function PaperPreview({ state, id, focus }: { state: State; id: string; focus: string | null }) {
  const p = state.papers[id];
  if (!p) return null;
  const findings = Object.values(state.findings).filter((f) => f.paper_id === id);
  const stances = { supports: 0, mixed: 0, refutes: 0 };
  for (const f of findings) {
    const s = focus ? f.evidence[focus]?.stance : Object.values(f.evidence)[0]?.stance;
    if (s) stances[s] += 1;
  }
  const reasons = [...(p.reasons ?? [])].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3);
  const authors = p.authors.slice(0, 3).map((a) => a.name);
  const meta = [p.journal, p.year].filter(Boolean).join(" · ");
  const facts = [p.design?.replace(/_/g, " "), p.n ? `n=${p.n.toLocaleString()}` : null, p.citations ? `${p.citations.toLocaleString()} citations` : null].filter(Boolean);

  return (
    <Card size="sm" className="tg-enter gap-2.5 p-3.5 shadow-[var(--shadow-md)]">
      <div>
        <div className="font-serif text-[14px] font-semibold leading-snug text-ink line-clamp-3">{p.title}</div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          {p.label}
          {meta && ` · ${meta}`}
        </div>
      </div>

      {(facts.length > 0 || p.retracted || p.peer_reviewed === false) && (
        <div className="flex flex-wrap gap-1">
          {facts.map((f) => (
            <span key={f} className="rounded bg-muted px-1.5 py-px text-[11px] capitalize text-ink-2">
              {f}
            </span>
          ))}
          {p.peer_reviewed === false && <span className="rounded bg-neu-soft px-1.5 py-px text-[11px] text-neu-ink">Not peer reviewed</span>}
          {p.retracted && <span className="rounded bg-neg-soft px-1.5 py-px text-[11px] font-medium text-neg-ink">Retracted</span>}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="text-muted-foreground">Credibility</span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-y-0 left-0 rounded-full bg-ink-2" style={{ width: `${p.credibility ?? 0}%` }} />
          </div>
          <span className="mono tabular w-6 text-right font-medium text-ink">{p.credibility ?? "··"}</span>
        </div>
        {reasons.map((r) => (
          <div key={r.id} className="flex justify-between gap-2 text-[11px] text-ink-3">
            <span className="truncate">{r.label}</span>
            <span className={`mono tabular ${r.points >= 0 ? "text-pos-ink" : "text-neg-ink"}`}>
              {r.points > 0 ? "+" : ""}
              {r.points}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-0.5 text-[11.5px] leading-[1.45]">
        <div className="text-ink-2">
          <span className="text-muted-foreground">Funding </span>
          {p.funders.length
            ? p.funders.slice(0, 3).map((f, i) => (
                <span key={f.id} className={f.type === "industry" ? "font-medium text-neg-ink" : ""}>
                  {i > 0 && ", "}
                  {f.name}
                  {f.type === "industry" && " (industry)"}
                </span>
              ))
            : "none disclosed"}
        </div>
        {authors.length > 0 && (
          <div className="truncate text-ink-2">
            <span className="text-muted-foreground">By </span>
            {authors.join(", ")}
            {p.authors.length > 3 && " et al."}
          </div>
        )}
      </div>

      {findings.length > 0 && (
        <div className="flex items-center gap-3 border-t pt-2 text-[11.5px] text-ink-2">
          {(["supports", "mixed", "refutes"] as const)
            .filter((s) => stances[s])
            .map((s) => (
              <span key={s} className="flex items-center gap-1">
                <StanceGlyph stance={s} size={12} />
                {stances[s]}
              </span>
            ))}
          <span className="ml-auto text-muted-foreground">Click for details</span>
        </div>
      )}
    </Card>
  );
}
