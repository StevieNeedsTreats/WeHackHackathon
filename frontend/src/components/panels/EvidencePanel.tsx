"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { State } from "@/lib/store";
import type { Direction } from "@/lib/types";
import { DirGlyph, Icon } from "../graph/glyphs";
import { SectionLabel } from "../Tip";

const FLAG_LABEL: Record<string, string> = {
  "small-sample": "Small sample (<30)",
  "sample-unreported": "Sample size not stated",
  preprint: "Preprint",
  "industry-funded": "Industry funded",
  "funding-undisclosed": "No funder listed",
  "animal-study": "Animal study",
  retracted: "Retracted",
  "low-credibility": "Credibility < 45",
  "unverified-quote": "Quote not verbatim",
  "no-effect-size": "No effect size",
  "source-error": "Source error",
};

type Filter = Direction | "all" | "flagged";

export function EvidencePanel({ state, onSelect }: { state: State; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const claims = useMemo(() => Object.values(state.nodes).filter((n) => n.kind === "claim"), [state.nodes]);
  const papers = state.nodes;
  const contradicted = useMemo(() => {
    const s = new Set<string>();
    for (const e of Object.values(state.edges)) {
      if (e.type === "CONTRADICTS") {
        s.add(e.source);
        s.add(e.target);
      }
    }
    return s;
  }, [state.edges]);

  const rows = claims
    .filter((c) => (filter === "all" ? true : filter === "flagged" ? (c.flags?.length ?? 0) > 0 || contradicted.has(c.id) : c.direction === filter))
    .sort((a, b) => (papers[`p:${b.paper_id}`]?.credibility ?? 0) - (papers[`p:${a.paper_id}`]?.credibility ?? 0));

  const flagCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of state.flags) m[f.code] = (m[f.code] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [state.flags]);

  return (
    <div className="p-5">
      <section className="mb-5">
        <SectionLabel className="mb-2">Validation</SectionLabel>
        {flagCounts.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No flags raised.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5">
            {flagCounts.map(([code, n]) => (
              <li key={code}>
                <Card size="sm" className="flex-row items-center justify-between gap-2 px-2.5 py-1.5 shadow-none">
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2">
                    <Icon name="flag" size={11} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{FLAG_LABEL[code] ?? code}</span>
                  </span>
                  <span className="mono tabular text-[12px] text-foreground">{n}</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Every claim&apos;s quote is checked verbatim against its abstract. Unverified claims count half in consensus.
        </p>
      </section>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={1}
        value={filter}
        onValueChange={(v) => v && setFilter(v as Filter)}
        className="mb-3 flex-wrap"
        aria-label="Filter claims"
      >
        <ToggleGroupItem value="all" className="rounded-full px-2.5 text-[11.5px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          All {claims.length}
        </ToggleGroupItem>
        {(
          [
            ["positive", "Positive"],
            ["neutral", "Mixed"],
            ["null", "Negative"],
            ["flagged", "Flagged"],
          ] as const
        ).map(([v, label]) => (
          <ToggleGroupItem key={v} value={v} className="rounded-full px-2.5 text-[11.5px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Card className="gap-0 py-0 shadow-none">
        <ul className="divide-y">
          {rows.map((c) => {
            const p = papers[`p:${c.paper_id}`];
            return (
              <li key={c.id}>
                <Button variant="ghost" onClick={() => onSelect(c.id)} className="h-auto w-full items-start justify-start gap-2.5 rounded-none px-3 py-2.5 text-left font-normal">
                  <DirGlyph dir={c.direction ?? "neutral"} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium text-foreground">{c.text}</span>
                      {contradicted.has(c.id) && (
                        <Badge variant="destructive" className="mono h-4 shrink-0 rounded-sm px-1 text-[9.5px] uppercase">
                          contested
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="truncate">{p?.label}</span>
                      <span>·</span>
                      <span className="mono tabular">cred {p?.credibility ?? "—"}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {c.quote_verified ? <Icon name="check" size={11} className="text-ok" /> : <Icon name="alert" size={11} />}
                        <span>{c.quote_verified ? "verified" : "unverified"}</span>
                      </span>
                    </div>
                  </div>
                </Button>
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-3 py-4 text-[12.5px] text-muted-foreground">No claims match.</li>}
        </ul>
      </Card>
    </div>
  );
}
