"use client";

import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { State } from "@/lib/store";
import type { GNode } from "@/lib/types";
import { DESIGN_SHORT, DIR, DirGlyph, Icon } from "../graph/glyphs";
import { SectionLabel } from "../Tip";
import { GradeBadge } from "./InsightsPanel";

const H = ({ children }: { children: React.ReactNode }) => <SectionLabel className="mb-1.5 mt-5">{children}</SectionLabel>;

function ClaimRow({ c, onSelect, note }: { c: GNode; onSelect: (id: string) => void; note?: string }) {
  return (
    <Button variant="ghost" onClick={() => onSelect(c.id)} className="h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left font-normal">
      <DirGlyph dir={c.direction ?? "neutral"} size={15} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-ink">{c.text}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{note ?? c.outcome}</span>
      </span>
    </Button>
  );
}

function Highlighted({ text, quotes }: { text: string; quotes: { q: string; dir: string }[] }) {
  // Mark every verified quote inside the abstract.
  const marks: { start: number; end: number; dir: string }[] = [];
  const low = text.toLowerCase();
  for (const { q, dir } of quotes) {
    const i = low.indexOf(q.toLowerCase());
    if (i >= 0 && !marks.some((m) => i < m.end && i + q.length > m.start)) marks.push({ start: i, end: i + q.length, dir });
  }
  marks.sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach((m, k) => {
    out.push(text.slice(at, m.start));
    out.push(
      <mark key={k} className="rounded-[2px] px-[1px] text-ink" style={{ background: DIR[m.dir as keyof typeof DIR].soft, boxShadow: `inset 0 -1.5px 0 ${DIR[m.dir as keyof typeof DIR].color}` }}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  });
  out.push(text.slice(at));
  return <p className="font-serif text-[13.5px] leading-[1.65] text-ink-2">{out}</p>;
}

export function DetailsPanel({ state, id, onSelect }: { state: State; id: string | null; onSelect: (id: string) => void }) {
  if (!id) return <p className="p-5 text-[13px] text-muted-foreground">Click any node or contradiction on the graph to inspect it.</p>;
  const nodes = state.nodes;
  const edges = Object.values(state.edges);

  const edge = state.edges[id];
  if (edge) {
    const a = nodes[edge.source];
    const b = nodes[edge.target];
    return (
      <div className="p-5">
        <div className="mono text-[10.5px] uppercase tracking-[0.1em] text-neg-ink">{edge.type}</div>
        <h3 className="mt-1 text-[16px] font-semibold text-ink">{edge.reason ?? "Relationship"}</h3>
        {edge.severity && <p className="mt-1 text-[12px] text-ink-3">Severity {edge.severity} — set by the lower credibility of the two papers.</p>}
        <H>Between</H>
        {a && <ClaimRow c={a} onSelect={onSelect} note={nodes[`p:${a.paper_id}`]?.label} />}
        {b && <ClaimRow c={b} onSelect={onSelect} note={nodes[`p:${b.paper_id}`]?.label} />}
      </div>
    );
  }

  const n = nodes[id];
  if (!n) return <p className="p-5 text-[13px] text-ink-3">That item is no longer on the graph.</p>;

  if (n.kind === "paper") {
    const claims = edges.filter((e) => e.type === "REPORTS" && e.source === id).map((e) => nodes[e.target]).filter(Boolean);
    const funders = edges.filter((e) => e.type === "FUNDED_BY" && e.source === id).map((e) => nodes[e.target]).filter(Boolean);
    const total = (n.cred_reasons ?? []).reduce((s, r) => s + r.points, 0);
    return (
      <div className="p-5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="mono h-4 rounded-sm px-1 text-[10px] font-normal">
            {DESIGN_SHORT[n.design ?? "Other"]}
          </Badge>
          <span className="text-[12px] text-ink-3">
            {n.journal} · {n.year}
          </span>
        </div>
        <h3 className="mt-2 font-serif text-[18px] font-semibold leading-snug text-ink">{n.title}</h3>
        <div className="mt-1 text-[12px] text-ink-2">{(n.first_authors ?? []).join(", ")}</div>
        {n.url && (
          <Button asChild variant="link" size="xs" className="mt-1 h-auto px-0 text-[12px]">
            <a href={n.url} target="_blank" rel="noreferrer noopener">
              {n.pmid ? `PubMed ${n.pmid}` : "Source"} <Icon name="link" size={11} />
            </a>
          </Button>
        )}
        {n.demo && (
          <Alert className="mt-2 bg-muted/60">
            <Info />
            <AlertDescription className="text-[11.5px]">Demo record: the abstract is an illustrative summary written for the demo, not the published text.</AlertDescription>
          </Alert>
        )}

        <H>Credibility {n.credibility ?? "—"} / 100</H>
        <ul className="space-y-1.5">
          {(n.cred_reasons ?? []).map((r) => (
            <li key={r.label} className="grid grid-cols-[96px_1fr_36px] items-center gap-2 text-[12px]">
              <span className="text-ink-2">{r.label}</span>
              <span className="relative h-[6px] rounded-full bg-surface-3">
                {r.points >= 0 ? (
                  <span className="absolute inset-y-0 left-0 rounded-full bg-ink-2" style={{ width: `${Math.min(100, (r.points / 40) * 100)}%` }} />
                ) : (
                  <span className="tg-hatch absolute inset-y-0 left-0 rounded-full border border-ink-3" style={{ width: `${Math.min(100, (-r.points / 40) * 100)}%` }} />
                )}
              </span>
              <span className="mono tabular text-right text-ink">{r.points > 0 ? `+${r.points}` : r.points}</span>
              <span className="col-span-3 -mt-1 text-[11px] text-ink-3">{r.detail}</span>
            </li>
          ))}
        </ul>
        {n.cred_reasons && <p className="mono mt-1 text-[10.5px] text-ink-3">sum {total} → clamped 0–100. Scored from metadata only, never from the result.</p>}

        {(n.flags?.length ?? 0) > 0 && (
          <>
            <H>Flags</H>
            <div className="flex flex-wrap gap-1">
              {n.flags!.map((f) => (
                <Badge key={f} variant="outline" className="mono rounded-sm text-[10.5px] font-normal text-ink-2">
                  {f}
                </Badge>
              ))}
            </div>
          </>
        )}

        <H>Provenance</H>
        <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-[12px]">
          <dt className="text-ink-3">Lab</dt>
          <dd className="text-ink-2">{n.lab ?? "—"}</dd>
          <dt className="text-ink-3">Region</dt>
          <dd className="text-ink-2">{n.region || "—"}</dd>
          <dt className="text-ink-3">Funding</dt>
          <dd className="text-ink-2">{funders.length ? funders.map((f) => `${f.name} (${f.type})`).join("; ") : "None listed"}</dd>
          <dt className="text-ink-3">Sample</dt>
          <dd className="mono text-ink-2">{n.studies ? `${n.studies} studies` : ""}{n.studies && n.sample_size ? " · " : ""}{n.sample_size ? `n=${n.sample_size.toLocaleString()}` : n.studies ? "" : "not stated"}</dd>
          <dt className="text-ink-3">Citations</dt>
          <dd className="mono text-ink-2">{(n.citations ?? 0).toLocaleString()}</dd>
        </dl>

        <H>Claims ({claims.length})</H>
        {claims.map((c) => (
          <ClaimRow key={c.id} c={c} onSelect={onSelect} />
        ))}

        {n.abstract && (
          <>
            <H>Abstract</H>
            <Highlighted text={n.abstract} quotes={claims.filter((c) => c.quote_verified && c.quote).map((c) => ({ q: c.quote!, dir: c.direction ?? "neutral" }))} />
          </>
        )}
      </div>
    );
  }

  if (n.kind === "claim") {
    const p = nodes[`p:${n.paper_id}`];
    const rel = edges.filter((e) => (e.type === "CONTRADICTS" || e.type === "SUPPORTS") && (e.source === id || e.target === id));
    const d = DIR[n.direction ?? "neutral"];
    return (
      <div className="p-5">
        <div className="flex items-center gap-2">
          <DirGlyph dir={n.direction ?? "neutral"} size={18} />
          <span className="text-[12px] font-medium" style={{ color: d.ink }}>
            {d.label}
            {n.harm ? " · harm" : ""}
          </span>
          <span className="mono ml-auto text-[10.5px] text-ink-3">{n.extractor === "claude" ? "claude-haiku-5-5" : "rule extractor"}</span>
        </div>
        <h3 className="mt-2 text-[18px] font-semibold leading-snug text-ink">{n.text}</h3>
        <div className="mt-1 text-[12.5px] text-ink-2">
          {n.outcome}
          {n.effect ? <span className="mono"> · {n.effect}</span> : null}
        </div>

        <H>Evidence</H>
        <blockquote className="rounded-[8px] border-l-[3px] bg-surface p-3 font-serif text-[14px] leading-[1.6] text-ink" style={{ borderColor: d.color }}>
          “{n.quote}”
        </blockquote>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-2">
          {n.quote_verified ? <Icon name="check" size={12} className="text-ok" /> : <Icon name="alert" size={12} />}
          {n.quote_verified ? "Found verbatim in the abstract" : "Not found verbatim — counted at half weight"}
        </div>

        {p && (
          <>
            <H>Source</H>
            <Card size="sm" role="button" tabIndex={0} onClick={() => onSelect(p.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(p.id)} className="cursor-pointer gap-0.5 px-3 shadow-none hover:ring-ink-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                <span className="mono text-[11px] text-ink-2">cred {p.credibility ?? "—"}</span>
              </div>
              <div className="line-clamp-2 text-[12px] text-ink-2">{p.title}</div>
            </Card>
          </>
        )}

        <H>Relationships ({rel.length})</H>
        {rel.length === 0 && <p className="text-[12px] text-ink-3">No other paper speaks to this outcome in a conflicting or corroborating way.</p>}
        {rel.map((e) => {
          const other = nodes[e.source === id ? e.target : e.source];
          if (!other) return null;
          return (
            <div key={e.id} className="mb-1">
              <div className="mono px-2 text-[10px] uppercase tracking-[0.08em]" style={{ color: e.type === "CONTRADICTS" ? DIR.null.ink : DIR.positive.ink }}>
                {e.type === "CONTRADICTS" ? `contradicts · ${e.reason}` : "supported by"}
              </div>
              <ClaimRow c={other} onSelect={onSelect} note={nodes[`p:${other.paper_id}`]?.label} />
            </div>
          );
        })}
      </div>
    );
  }

  // outcome, funder, author, lab: list what hangs off them
  const linkedPapers = (() => {
    if (n.kind === "outcome") return [];
    const t = n.kind === "funder" ? "FUNDED_BY" : n.kind === "author" ? "AUTHORED_BY" : "FROM_LAB";
    return edges.filter((e) => e.type === t && e.target === id).map((e) => nodes[e.source]).filter(Boolean);
  })();
  const claims =
    n.kind === "outcome"
      ? edges.filter((e) => e.type === "ABOUT" && e.target === id).map((e) => nodes[e.source]).filter(Boolean)
      : linkedPapers.flatMap((p) => edges.filter((e) => e.type === "REPORTS" && e.source === p.id).map((e) => nodes[e.target])).filter(Boolean);
  const cons = state.insights?.consensus.find((c) => `o:${c.outcome_key}` === id);

  return (
    <div className="p-5">
      <div className="mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
        {n.kind}
        {n.type ? ` · ${n.type}` : ""}
      </div>
      <h3 className="mt-1 text-[18px] font-semibold leading-snug text-ink">{n.name}</h3>
      {n.region && <div className="text-[12.5px] text-ink-2">{n.region}</div>}
      {cons && (
        <p className="mt-2 text-[12.5px] text-ink-2">
          <span className="mr-1.5 inline-block align-middle">
            <GradeBadge grade={cons.grade} verdict={cons.verdict} />
          </span>
          {cons.verdict} — {Math.round(cons.share.positive * 100)}% positive by credibility weight across {cons.papers} paper{cons.papers !== 1 ? "s" : ""}.
        </p>
      )}
      {linkedPapers.length > 0 && (
        <>
          <H>Papers ({linkedPapers.length})</H>
          {linkedPapers.map((p) => (
            <Button key={p.id} variant="ghost" onClick={() => onSelect(p.id)} className="h-auto w-full justify-between px-2 py-1.5 font-normal">
              <span className="truncate text-[12.5px] text-ink">{p.label}</span>
              <span className="mono text-[11px] text-muted-foreground">cred {p.credibility ?? "—"}</span>
            </Button>
          ))}
        </>
      )}
      <H>Claims ({claims.length})</H>
      {claims.map((c) => (
        <ClaimRow key={c.id} c={c} onSelect={onSelect} note={nodes[`p:${c.paper_id}`]?.label} />
      ))}
    </div>
  );
}
