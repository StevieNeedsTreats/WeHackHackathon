"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { explanation, type State } from "@/lib/store";
import type { Finding } from "@/lib/types";
import { designShort, DIRECTION, Icon, STANCE, StanceGlyph } from "../graph/glyphs";
import { SectionLabel } from "../Tip";

const H = ({ children }: { children: React.ReactNode }) => <SectionLabel className="mb-1.5 mt-5">{children}</SectionLabel>;

const FLAG_TEXT: Record<string, string> = {
  "small-sample": "Fewer than 30 participants",
  preprint: "Not peer reviewed",
  "no-results-posted": "Registered trial with no results posted",
  "industry-funded": "Industry funding disclosed",
  "funding-undisclosed": "No funder listed",
  "animal-study": "Animal or lab study",
  retracted: "Retracted",
  "low-credibility": "Credibility below 40",
};

function FindingLink({ f, state, hk, onSelect }: { f: Finding; state: State; hk: string | null; onSelect: (id: string) => void }) {
  const e = hk ? f.evidence[hk] : null;
  return (
    <Button variant="ghost" onClick={() => onSelect(`f:${f.id}`)} className="h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left font-normal">
      {e ? <StanceGlyph stance={e.stance} size={15} /> : <span className="w-[15px] text-center text-ink-3">{DIRECTION[f.direction]?.arrow}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-ink">{f.text}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {f.outcome.name}, {state.papers[f.paper_id]?.label}
        </span>
      </span>
    </Button>
  );
}

export function DetailsPanel({ state, id, hk, onSelect }: { state: State; id: string | null; hk: string | null; onSelect: (id: string) => void }) {
  if (!id) return <p className="p-5 text-[13px] text-muted-foreground">Click a paper, finding or contradiction on the graph to inspect it.</p>;

  if (id.startsWith("c:")) {
    // Finding ids contain colons, so look the pair up rather than splitting the id.
    const c = Object.values(state.contradictions).flat().find((x) => `c:${x.a}:${x.b}` === id);
    const fa = c && state.findings[c.a];
    const fb = c && state.findings[c.b];
    return (
      <div className="p-5">
        <div className={`text-[11px] ${c?.explained_by ? "text-ink-3" : "text-neg-ink"}`}>
          {c?.explained_by ? "Explained contradiction" : "Contradiction"}
        </div>
        <h3 className="mt-1 text-[16px] font-semibold text-ink">{c?.reason ?? "Conflict"}</h3>
        {c?.explained_by ? (
          <p className="mt-1 text-[12.5px] text-ink-2">
            The findings disagree, but the studies differ{explanation(c) ? `: ${explanation(c)}` : " in this way"}, so it is probably not a real conflict.
          </p>
        ) : (
          <p className="mt-1 text-[12.5px] text-ink-2">No study difference explains it: a real disagreement in the literature.</p>
        )}
        {c?.severity && <p className="mt-1 text-[11.5px] text-ink-3">Severity {c.severity}, set by the lower credibility of the two papers.</p>}
        <H>Between</H>
        {fa && <FindingLink f={fa} state={state} hk={hk} onSelect={onSelect} />}
        {fb && <FindingLink f={fb} state={state} hk={hk} onSelect={onSelect} />}
      </div>
    );
  }

  if (id.startsWith("f:")) {
    const f = state.findings[id.slice(2)];
    if (!f) return <p className="p-5 text-[13px] text-ink-3">That finding is no longer on the graph.</p>;
    const p = state.papers[f.paper_id];
    const st = state.studies[f.study_id];
    const evid = Object.entries(f.evidence);
    return (
      <div className="p-5">
        <div className="text-[11px] text-ink-3">Finding on {f.outcome.name}</div>
        <h3 className="mt-1 text-[16px] font-semibold leading-snug text-ink">{f.text}</h3>
        <div className="mt-1 text-[11.5px] text-ink-2">
          {DIRECTION[f.direction]?.arrow} {DIRECTION[f.direction]?.label}
          {f.effect_text ? `, ${f.effect_text}` : f.effect_value != null ? `, ${f.effect_value} ${f.effect_unit ?? ""}` : ""}
        </div>
        {f.quote && (
          <>
            <H>Quote</H>
            <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[14px] leading-[1.6] text-ink">“{f.quote}”</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-3">
              {f.quote_verified ? <Icon name="check" size={11} /> : <Icon name="alert" size={11} />}
              {f.quote_verified ? "Found verbatim in the source text" : "Not found verbatim in the source; its weight is halved"}
            </p>
          </>
        )}
        {evid.length > 0 && (
          <>
            <H>Stance per hypothesis</H>
            <ul className="space-y-2">
              {evid.map(([k, e]) => (
                <li key={k} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <StanceGlyph stance={e.stance} size={14} />
                    <span className="text-[12px] font-medium" style={{ color: STANCE[e.stance].ink }}>
                      {STANCE[e.stance].label}
                    </span>
                    <span className="ml-auto text-[11px] text-ink-3">weight {e.weight.toFixed(2)}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink-3">{state.hyps[k]?.statement}</div>
                  {e.rationale && <div className="mt-1 text-[12px] text-ink-2">{e.rationale}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
        {st && (
          <>
            <H>Study</H>
            <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-[12px]">
              {(
                [
                  ["Design", st.design],
                  ["Participants", st.n?.toLocaleString()],
                  ["Pooled studies", st.pooled_studies],
                  ["Population", st.population],
                  ["Exposure", st.exposure],
                  ["Comparator", st.comparator],
                  ["Duration", st.duration],
                  ["Setting", st.setting],
                ] as [string, unknown][]
              )
                .filter(([, v]) => v != null && v !== "")
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="text-ink-2">{String(v)}</dd>
                  </div>
                ))}
            </dl>
          </>
        )}
        {p && (
          <>
            <H>Paper</H>
            <Button variant="ghost" onClick={() => onSelect(`p:${p.id}`)} className="h-auto w-full justify-start px-2 py-1.5 text-left font-normal">
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-ink">{p.title}</span>
                <span className="block text-[11px] text-ink-3">
                  {p.label}, credibility {p.credibility ?? "…"}
                </span>
              </span>
            </Button>
          </>
        )}
      </div>
    );
  }

  const pid = id.startsWith("p:") ? id.slice(2) : id;
  const p = state.papers[pid];
  if (!p) return <p className="p-5 text-[13px] text-ink-3">Click a paper, finding or contradiction to inspect it.</p>;
  const findings = Object.values(state.findings).filter((f) => f.paper_id === pid);
  const studies = Object.values(state.studies).filter((s) => s.paper_id === pid);
  const total = (p.reasons ?? []).reduce((s, r) => s + r.points, 0);
  return (
    <div className="p-5">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="rounded-sm text-[11px]">
          {designShort(p.design)}
        </Badge>
        <span className="text-[11px] text-ink-3">
          {p.year}, {p.journal ?? p.kind}
        </span>
      </div>
      <h3 className="mt-1.5 text-[15.5px] font-semibold leading-snug text-ink">{p.title}</h3>
      <div className="mt-1 text-[12px] text-ink-2">
        {p.authors.map((a) => a.name).join(", ")}
        {p.authors.length >= 3 ? " et al." : ""}
      </div>
      {p.url && (
        <a href={p.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink">
          Open source <Icon name="link" size={11} />
        </a>
      )}

      <H>Credibility {p.credibility ?? "…"} out of 100</H>
      {p.reasons?.length ? (
        <ul className="space-y-1">
          {p.reasons.map((r) => (
            <li key={r.id ?? r.label} className="grid grid-cols-[1fr_auto] gap-x-2 text-[12px]">
              <span className="text-ink-2">
                {r.label}
                {r.judged && <span className="ml-1 text-[11px] text-ink-4">LLM</span>}
              </span>
              <span className={`tabular text-right ${r.points < 0 ? "text-neg-ink" : "text-ink"}`}>
                {r.points > 0 ? "+" : ""}
                {r.points}
              </span>
              <span className="col-span-2 text-[11px] leading-snug text-ink-3">{r.detail}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-line pt-1 text-[11px] text-ink-3">
            <span>sum (clamped 0–100)</span>
            <span>{total}</span>
          </li>
        </ul>
      ) : (
        <p className="text-[12px] text-ink-3">Not scored yet.</p>
      )}
      {(p.flags ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.flags!.map((f) => (
            <Badge key={f} variant="secondary" className="rounded-sm text-[11px] font-normal">
              {FLAG_TEXT[f] ?? f}
            </Badge>
          ))}
        </div>
      )}

      {(p.funders.length > 0 || p.labs.length > 0) && (
        <>
          <H>Funding & affiliations</H>
          <ul className="space-y-0.5 text-[12px] text-ink-2">
            {p.funders.map((f) => (
              <li key={f.id}>
                <span className="mr-1.5 text-[11px] text-ink-3">{f.type}</span>
                {f.name}
              </li>
            ))}
            {p.labs.map((l) => (
              <li key={l.id} className="text-ink-3">
                {l.name}
                {l.country ? `, ${l.country}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {studies.length > 0 && (
        <>
          <H>Studies</H>
          {studies.map((s) => (
            <p key={s.id} className="text-[12px] text-ink-2">
              {s.design}
              {s.n ? `, n=${s.n.toLocaleString()}` : ""}
              {s.population ? `, ${s.population}` : ""}
              {s.exposure ? `, ${s.exposure}` : ""}
            </p>
          ))}
        </>
      )}

      {findings.length > 0 && (
        <>
          <H>Findings ({findings.length})</H>
          {findings.map((f) => (
            <FindingLink key={f.id} f={f} state={state} hk={hk} onSelect={onSelect} />
          ))}
        </>
      )}

      {Object.keys(p.considered).length > 0 && (
        <>
          <H>Considered for</H>
          <ul className="space-y-0.5 text-[12px] text-ink-2">
            {Object.entries(p.considered).map(([k, c]) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="truncate">{state.hyps[k]?.statement ?? k}</span>
                <span className="shrink-0 text-[11px] text-ink-3">rel {c.relevance?.toFixed?.(2) ?? c.relevance}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
