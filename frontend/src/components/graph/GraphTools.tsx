"use client";

import { ListFilter } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { State } from "@/lib/store";
import type { Stance } from "@/lib/types";
import { STANCE, StanceGlyph } from "./glyphs";
import { Tip } from "../Tip";

/*
 * Filter the canvas. Filters dim what doesn't match rather than removing it, so the layout holds
 * still and the reader keeps their bearings.
 */

export interface Filter {
  stances: Stance[]; // empty: every stance
  designs: string[]; // empty: every design
  minCred: number; // 0: any credibility
  from: number | null;
  to: number | null;
  noIndustry: boolean;
}

export const NO_FILTER: Filter = { stances: [], designs: [], minCred: 0, from: null, to: null, noIndustry: false };

const designOf = (d?: string) => (d || "unknown").replace(/_/g, " ").toLowerCase();

export function filterCount(f: Filter) {
  return (f.stances.length ? 1 : 0) + (f.designs.length ? 1 : 0) + (f.minCred ? 1 : 0) + (f.from != null || f.to != null ? 1 : 0) + (f.noIndustry ? 1 : 0);
}

/** The node ids a filter keeps, among `ids` (React Flow ids: p:…, f:…), or null when nothing is filtered. */
export function keep(state: State, ids: string[], focus: string | null, f: Filter): Set<string> | null {
  if (!filterCount(f)) return null;
  const paperOk = (pid: string) => {
    const p = state.papers[pid];
    if (!p) return false;
    if (f.designs.length && !f.designs.includes(designOf(p.design))) return false;
    if (f.minCred && (p.credibility ?? -1) < f.minCred) return false;
    if ((f.from != null || f.to != null) && (!p.year || (f.from != null && p.year < f.from) || (f.to != null && p.year > f.to))) return false;
    if (f.noIndustry && p.funders.some((x) => x.type === "industry")) return false;
    return true;
  };
  const stanceOk = (fid: string) => {
    if (!f.stances.length) return true;
    const ev = state.findings[fid]?.evidence ?? {};
    const st = focus ? [ev[focus]?.stance] : Object.values(ev).map((e) => e.stance);
    return st.some((s) => s && f.stances.includes(s));
  };
  const out = new Set<string>();
  const papersWithFinding = new Set<string>();
  for (const id of ids) {
    if (!id.startsWith("f:")) continue;
    const fd = state.findings[id.slice(2)];
    if (fd && paperOk(fd.paper_id) && stanceOk(fd.id)) {
      out.add(id);
      papersWithFinding.add(fd.paper_id);
    }
  }
  for (const id of ids) {
    if (id.startsWith("p:")) {
      const pid = id.slice(2);
      if (paperOk(pid) && (!f.stances.length || papersWithFinding.has(pid))) out.add(id);
    } else if (!id.startsWith("f:")) out.add(id); // hypotheses, labels, the question
  }
  return out;
}

export function GraphTools({
  state,
  filter,
  setFilter,
  shown,
}: {
  state: State;
  filter: Filter;
  setFilter: (f: Filter) => void;
  shown: { findings: number; of: number } | null;
}) {
  return (
    <Card size="sm" data-overlay="top" className="tg-float absolute right-4 top-4 z-10 flex-row items-center gap-0 rounded-xl p-0">
      <FilterButton state={state} filter={filter} setFilter={setFilter} n={filterCount(filter)} shown={shown} />
    </Card>
  );
}

const CRED = [0, 40, 60, 80];

function FilterButton({ state, filter, setFilter, n, shown }: { state: State; filter: Filter; setFilter: (f: Filter) => void; n: number; shown: { findings: number; of: number } | null }) {
  const designs = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of Object.values(state.papers)) c[designOf(p.design)] = (c[designOf(p.design)] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [state.papers]);
  const years = useMemo(() => {
    const ys = Object.values(state.papers).map((p) => p.year).filter((y): y is number => !!y);
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
  }, [state.papers]);
  const set = (patch: Partial<Filter>) => setFilter({ ...filter, ...patch });
  const yearInput = (key: "from" | "to", placeholder: number) => (
    <input
      type="number"
      inputMode="numeric"
      value={filter[key] ?? ""}
      placeholder={String(placeholder)}
      min={years?.[0]}
      max={years?.[1]}
      onChange={(e) => set({ [key]: e.target.value ? Number(e.target.value) : null })}
      aria-label={key === "from" ? "From year" : "To year"}
      className="h-7 w-[72px] rounded-md border bg-background px-2 text-[12px] outline-none focus:border-ring"
    />
  );
  const label = "text-[12px] font-medium text-muted-foreground";

  return (
    <Popover>
      <Tip label="Filter the graph">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={`h-8 gap-1 rounded-xl px-2.5 text-[12px] ${n ? "text-ink" : "text-muted-foreground"}`} aria-label="Filter the graph">
            <ListFilter className="size-3.5" />
            {n > 0 && <span className="rounded-full bg-primary px-1.5 text-[12px] leading-4 text-primary-foreground">{n}</span>}
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-72 space-y-3.5 p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink">Filter</span>
          {shown && n > 0 && (
            <span className="text-[12.5px] text-muted-foreground">
              {shown.findings} of {shown.of} findings
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          <div className={label}>Stance</div>
          <ToggleGroup type="multiple" variant="outline" size="sm" spacing={1} value={filter.stances} onValueChange={(v) => set({ stances: v as Stance[] })} className="flex-wrap">
            {(["supports", "mixed", "refutes"] as const).map((s) => (
              <ToggleGroupItem key={s} value={s} className="h-7 gap-1.5 rounded-full px-2.5 text-[12px] font-normal data-[state=on]:bg-accent data-[state=on]:text-foreground">
                <StanceGlyph stance={s} size={11} />
                {STANCE[s].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <div className={label}>Study design</div>
          <ToggleGroup type="multiple" variant="outline" size="sm" spacing={1} value={filter.designs} onValueChange={(v) => set({ designs: v })} className="flex-wrap">
            {designs.map(([d, c]) => (
              <ToggleGroupItem key={d} value={d} className="h-7 rounded-full px-2.5 text-[12px] font-normal capitalize data-[state=on]:bg-accent data-[state=on]:text-foreground">
                {d} <span className="tabular text-muted-foreground">{c}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <div className={label}>Credibility</div>
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} value={String(filter.minCred)} onValueChange={(v) => v && set({ minCred: Number(v) })}>
            {CRED.map((c) => (
              <ToggleGroupItem key={c} value={String(c)} className="h-7 rounded-full px-2.5 text-[12px] font-normal data-[state=on]:bg-accent data-[state=on]:text-foreground">
                {c ? `${c}+` : "Any"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {years && (
          <div className="space-y-1.5">
            <div className={label}>Published</div>
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              {yearInput("from", years[0])}
              to
              {yearInput("to", years[1])}
            </div>
          </div>
        )}
        <label className="flex items-center justify-between gap-2 text-[12.5px] text-ink-2">
          Hide industry-funded papers
          <Switch checked={filter.noIndustry} onCheckedChange={(v) => set({ noIndustry: v })} />
        </label>
        {n > 0 && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setFilter(NO_FILTER)}>
            Clear filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
