"use client";

import { Card } from "@/components/ui/card";
import { balance, evidenceFor, explanation, papersFor, type State } from "@/lib/store";
import { designShort, STANCE } from "./graph/glyphs";
import { BalanceBar } from "./graph/nodes";
import { GradeBadge } from "./panels/VerdictPanel";
import { SectionLabel } from "./Tip";

/** Hypotheses side by side: verdict, balance, best evidence, key contradiction, shared papers. */
export function CompareView({ state, onFocus }: { state: State; onFocus: (key: string) => void }) {
  const keys = state.hypOrder;
  const sets = Object.fromEntries(keys.map((k) => [k, new Set(papersFor(state, k).map((p) => p.id))]));
  return (
    <div className="h-full overflow-auto p-5">
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(260px, 1fr))` }}>
        {keys.map((k, i) => {
          const h = state.hyps[k];
          const v = state.verdicts[k];
          const b = balance(state, k);
          const rows = evidenceFor(state, k);
          const best = rows[0];
          const contra = (state.contradictions[k] ?? []).find((c) => !c.explained_by) ?? state.contradictions[k]?.[0];
          const shared = keys.filter((o) => o !== k).map((o) => ({ o, n: [...sets[k]].filter((p) => sets[o].has(p)).length })).filter((x) => x.n);
          return (
            <Card key={k} className="gap-3 p-4">
              <button type="button" onClick={() => onFocus(k)} className="text-left">
                <span className="text-[12px] text-ink-3">H{i + 1}</span>
                <h3 className="text-[15px] font-semibold leading-snug text-ink hover:underline">{h.statement}</h3>
              </button>
              <div>{v ? <GradeBadge v={v} /> : <span className="text-[12px] text-ink-3">{state.status === "streaming" ? "Researching…" : "No verdict"}</span>}</div>
              <div>
                <BalanceBar support={b.support} refute={b.refute} mixed={b.mixed} className="h-[10px]" />
                <div className="mt-1 flex justify-between text-[12px]">
                  <span style={{ color: STANCE.supports.ink }}>{Math.round(b.support * 100)}% supports</span>
                  <span style={{ color: STANCE.refutes.ink }}>{Math.round(b.refute * 100)}% refutes</span>
                </div>
              </div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5 text-[12px]">
                <dt className="text-ink-3">Papers</dt>
                <dd className="text-ink-2">
                  {sets[k].size} considered{v ? `, ${v.papers} with relevant findings` : ""}
                </dd>
                <dt className="text-ink-3">Best evidence</dt>
                <dd className="text-ink-2">
                  {best ? (
                    <>
                      <span className="text-[12px]">{designShort(best.study?.design ?? best.paper.design)}</span> {best.paper.label}: {best.finding.text}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-ink-3">Key conflict</dt>
                <dd className="text-ink-2">
                  {contra
                    ? `${state.papers[state.findings[contra.a]?.paper_id]?.label ?? "?"} vs ${state.papers[state.findings[contra.b]?.paper_id]?.label ?? "?"}: ${contra.reason}${contra.explained_by ? ` (explained${explanation(contra) ? `: ${explanation(contra)}` : ""})` : ""}`
                    : "None found"}
                </dd>
                <dt className="text-ink-3">Shared papers</dt>
                <dd className="text-ink-2">{shared.length ? shared.map((x) => `${x.n} with H${keys.indexOf(x.o) + 1}`).join(", ") : "None"}</dd>
              </dl>
              {v?.summary && (
                <>
                  <SectionLabel>Summary</SectionLabel>
                  <p className="text-[12.5px] leading-[1.6] text-ink-2">{v.summary}</p>
                </>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
