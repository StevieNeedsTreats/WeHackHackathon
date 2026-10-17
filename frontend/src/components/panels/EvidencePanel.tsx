"use client";

import { Badge } from "@/components/ui/badge";
import { evidenceFor, type Row, type State } from "@/lib/store";
import type { Stance } from "@/lib/types";
import { designShort, Icon, STANCE, StanceGlyph } from "../graph/glyphs";
import { SectionLabel } from "../Tip";

function FindingRow({ r, onSelect }: { r: Row; onSelect: (id: string) => void }) {
  const f = r.finding;
  return (
    <button type="button" onClick={() => onSelect(`f:${f.id}`)} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-ink-3">
      <div className="flex items-start gap-2">
        <StanceGlyph stance={r.stance.stance} size={15} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium leading-snug text-ink">{f.text}</div>
          <div className="mono mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-ink-3">
            <span className="text-ink-2">{r.paper.label}</span>
            <span>·</span>
            <span>{designShort(r.study?.design ?? r.paper.design)}</span>
            {r.study?.n ? (
              <>
                <span>·</span>
                <span>n={r.study.n.toLocaleString()}</span>
              </>
            ) : null}
            <span>·</span>
            <span>cred {r.paper.credibility ?? "…"}</span>
            {f.harm && (
              <Badge variant="destructive" className="h-3.5 rounded-sm px-1 text-[9px] uppercase">
                harm
              </Badge>
            )}
          </div>
          {f.quote && (
            <p className="mt-1.5 border-l-2 border-line-2 pl-2 font-serif text-[12px] italic leading-snug text-ink-2">
              “{f.quote.length > 220 ? f.quote.slice(0, 217) + "…" : f.quote}”
              {f.quote_verified === false && (
                <span className="ml-1 inline-flex items-center gap-0.5 not-italic text-ink-3" title="Not found verbatim in the source">
                  <Icon name="alert" size={10} /> unverified
                </span>
              )}
            </p>
          )}
          {r.stance.rationale && <p className="mt-1 text-[11.5px] leading-snug text-ink-3">Why: {r.stance.rationale}</p>}
        </div>
      </div>
    </button>
  );
}

export function EvidencePanel({ state, hk, onSelect }: { state: State; hk: string | null; onSelect: (id: string) => void }) {
  if (!hk) return <p className="p-5 text-[13px] text-muted-foreground">Pick a hypothesis to see its evidence.</p>;
  const rows = evidenceFor(state, hk);
  const flags = state.flags.filter((f) => f.target.startsWith("h:" + hk) || f.target.startsWith("q:"));
  if (!rows.length)
    return (
      <p className="p-5 text-[13px] text-muted-foreground">
        {state.status === "streaming" ? "Findings appear here once the Stance agent has judged them." : "No findings were judged relevant to this hypothesis."}
      </p>
    );
  return (
    <div className="space-y-5 p-5">
      {(["supports", "refutes", "mixed"] as Stance[]).map((st) => {
        const list = rows.filter((r) => r.stance.stance === st);
        if (!list.length) return null;
        return (
          <section key={st}>
            <SectionLabel className="mb-2">
              <span style={{ color: STANCE[st].ink }}>{STANCE[st].label}</span> · {list.length}
            </SectionLabel>
            <div className="space-y-1.5">
              {list.map((r) => (
                <FindingRow key={r.finding.id} r={r} onSelect={onSelect} />
              ))}
            </div>
          </section>
        );
      })}
      {flags.length > 0 && (
        <section>
          <SectionLabel className="mb-2">Run notes</SectionLabel>
          <ul className="space-y-1 text-[12px] text-ink-2">
            {flags.map((f, i) => (
              <li key={i}>
                <span className="mono text-[10.5px] text-ink-3">{f.code}</span> {f.detail}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
