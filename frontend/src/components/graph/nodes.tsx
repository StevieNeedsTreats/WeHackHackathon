"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { CLAIM_W, PAPER_W, SPINE_X, type Row } from "@/lib/layout";
import type { GNode } from "@/lib/types";
import { dimClass, useGraph } from "./context";
import { DESIGN_SHORT, DIR, DirGlyph, Icon } from "./glyphs";

type Data = { n: GNode; w: number; h: number };

const H = ({ id, type, pos, left }: { id: string; type: "source" | "target"; pos: Position; left?: number }) => (
  <Handle id={id} type={type} position={pos} isConnectable={false} style={left != null ? { left } : undefined} />
);

function useNodeClass(id: string, base: string) {
  const ctx = useGraph();
  const sel = ctx.selected === id;
  return `${base} tg-node ${dimClass(ctx, id)} ${ctx.fresh.has(id) ? "tg-enter" : ""} ${sel ? "ring-2 ring-ink ring-offset-2 ring-offset-bg" : ""}`;
}

export const SubstanceNode = memo(function SubstanceNode({ id, data }: NodeProps & { data: Data }) {
  const cls = useNodeClass(id, "rounded-[10px] bg-ink px-4 py-3 text-white shadow-[var(--shadow-md)]");
  return (
    <div className={cls} style={{ width: data.w, height: data.h }}>
      <div className="mono text-[10px] uppercase tracking-[0.14em] text-white/55">Substance</div>
      <div className="truncate text-[19px] font-semibold leading-tight tracking-[-0.01em]">{data.n.name}</div>
      <H id="b" type="source" pos={Position.Bottom} />
    </div>
  );
});

export const PaperNode = memo(function PaperNode({ id, data }: NodeProps & { data: Data }) {
  const p = data.n;
  const cls = useNodeClass(id, "rounded-[8px] border border-line-2 bg-surface px-3 pb-2.5 pt-2.5 shadow-[var(--shadow-sm)] hover:border-ink-3");
  const cred = p.credibility;
  const flags = (p.flags ?? []).filter((f) => f !== "funding-undisclosed").length;
  const sample = p.studies ? `${p.studies} studies` : p.sample_size ? `n=${p.sample_size.toLocaleString()}` : "n=?";
  return (
    <div className={cls} style={{ width: PAPER_W, height: data.h }} title={p.title}>
      <H id="top" type="target" pos={Position.Top} />
      <H id="arc-s" type="source" pos={Position.Top} left={PAPER_W / 2 - 6} />
      <H id="arc-t" type="target" pos={Position.Top} left={PAPER_W / 2 + 6} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate text-[13.5px] font-semibold leading-5 tracking-[-0.005em] text-ink">{p.label}</div>
        <span className="mono mt-[2px] shrink-0 rounded-[3px] border border-line-2 px-1 text-[9.5px] leading-[14px] tracking-[0.04em] text-ink-2">
          {DESIGN_SHORT[p.design ?? "Other"] ?? p.design}
        </span>
      </div>
      <div className="mono mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-3">
        <span className="tabular">{sample}</span>
        <span aria-hidden>·</span>
        <span className="tabular">{(p.citations ?? 0).toLocaleString()} cites</span>
        {p.demo && <span className="ml-auto rounded-[3px] bg-surface-3 px-1 text-[9px] uppercase tracking-wider text-ink-3">demo</span>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-surface-3">
          {cred == null ? (
            <div className="tg-shimmer absolute inset-0" />
          ) : (
            <div className="absolute inset-y-0 left-0 rounded-full bg-ink-2 transition-[width] duration-700 ease-out" style={{ width: `${cred}%` }} />
          )}
        </div>
        <span className="mono tabular w-[22px] text-right text-[12px] font-medium text-ink">{cred ?? "··"}</span>
        {flags > 0 && (
          <span className="mono flex items-center gap-0.5 text-[10px] text-ink-3" title={`${flags} validation flag${flags > 1 ? "s" : ""}`}>
            <Icon name="flag" size={10} />
            {flags}
          </span>
        )}
      </div>
      <H id="meta" type="source" pos={Position.Bottom} left={14} />
      <H id="spine" type="source" pos={Position.Bottom} left={SPINE_X} />
    </div>
  );
});

export const AuthorNode = memo(function AuthorNode({ id, data }: NodeProps & { data: Data }) {
  const cls = useNodeClass(id, "flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[11.5px] text-ink-2");
  return (
    <div className={cls} style={{ width: data.w, height: data.h }} title={data.n.name}>
      <H id="top" type="target" pos={Position.Top} left={14} />
      <Icon name="person" size={11} className="shrink-0 text-ink-3" />
      <span className="truncate">{data.n.name}</span>
    </div>
  );
});

export const LabNode = memo(function LabNode({ id, data }: NodeProps & { data: Data }) {
  const n = data.n;
  const cls = useNodeClass(id, "flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 text-[11px] text-ink-2");
  return (
    <div className={cls} style={{ width: data.w, height: data.h }} title={`${n.name}${n.region ? ` — ${n.region}` : ""}`}>
      <H id="top" type="target" pos={Position.Top} left={14} />
      <Icon name="lab" size={11} className="shrink-0 text-ink-3" />
      <span className="truncate">{n.name}</span>
      {n.region && <span className="ml-auto shrink-0 text-[10px] text-ink-3">{n.region.length > 14 ? n.region.slice(0, 13) + "…" : n.region}</span>}
    </div>
  );
});

const FUNDER_LABEL: Record<string, string> = { industry: "Industry", public: "Public", academic: "Academic", other: "Other" };

export const FunderNode = memo(function FunderNode({ id, data }: NodeProps & { data: Data }) {
  const n = data.n;
  const industry = n.type === "industry";
  const cls = useNodeClass(
    id,
    `flex items-center gap-1.5 rounded-[6px] border px-2 text-[11px] ${industry ? "tg-hatch border-ink-3 bg-surface text-ink" : "border-line-2 bg-surface text-ink-2"}`,
  );
  return (
    <div className={cls} style={{ width: data.w, height: data.h }} title={`${n.name} (${FUNDER_LABEL[n.type ?? "other"]})`}>
      <H id="top" type="target" pos={Position.Top} />
      <span className={`mono shrink-0 text-[9px] uppercase tracking-[0.08em] ${industry ? "font-medium text-ink" : "text-ink-3"}`}>{FUNDER_LABEL[n.type ?? "other"]}</span>
      <span className="truncate">{n.name}</span>
    </div>
  );
});

export const ClaimNode = memo(function ClaimNode({ id, data }: NodeProps & { data: Data }) {
  const c = data.n;
  const dir = c.direction ?? "neutral";
  const d = DIR[dir];
  const cls = useNodeClass(id, "relative overflow-hidden rounded-[7px] border bg-surface pl-3 pr-2.5 py-2 shadow-[var(--shadow-sm)]");
  return (
    <div className={cls} style={{ width: CLAIM_W, height: data.h, borderColor: "var(--line-2)" }} title={c.quote}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: d.color }} />
      <H id="spine" type="target" pos={Position.Top} left={SPINE_X} />
      <H id="l-s" type="source" pos={Position.Left} />
      <H id="l-t" type="target" pos={Position.Left} />
      <H id="r-s" type="source" pos={Position.Right} />
      <H id="r-t" type="target" pos={Position.Right} />
      <div className="flex items-start gap-2">
        <DirGlyph dir={dir} size={16} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium leading-4 text-ink">{c.text}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
            <span className="truncate">{c.outcome}</span>
            {c.harm && (
              <span className="mono shrink-0 rounded-[3px] px-1 text-[9px] uppercase tracking-wider text-neg-ink" style={{ background: "var(--neg-soft)" }}>
                harm
              </span>
            )}
            {c.quote_verified === false && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 text-ink-3" title="Quote not found verbatim in abstract">
                <Icon name="alert" size={10} />
              </span>
            )}
          </div>
        </div>
      </div>
      <H id="b" type="source" pos={Position.Bottom} />
    </div>
  );
});

export const OutcomeNode = memo(function OutcomeNode({ id, data }: NodeProps & { data: Data }) {
  const o = data.n;
  const ctx = useGraph();
  const cons = ctx.consensus[id];
  const counts = o.counts ?? { positive: 0, neutral: 0, null: 0 };
  const total = counts.positive + counts.neutral + counts.null || 1;
  const cls = useNodeClass(id, "rounded-[9px] border border-ink-3/40 bg-surface px-3 py-2 shadow-[var(--shadow-sm)]");
  return (
    <div className={cls} style={{ width: data.w, height: data.h }}>
      <H id="top" type="target" pos={Position.Top} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-semibold text-ink">{o.name}</span>
        {cons && (
          <span className="mono shrink-0 rounded-[3px] bg-ink px-1 text-[10px] leading-[15px] text-white" title={`Evidence grade ${cons.grade}: ${cons.verdict}`}>
            {cons.grade}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex h-[6px] gap-[2px]" aria-label={`${counts.positive} positive, ${counts.neutral} mixed, ${counts.null} negative`}>
        {(["positive", "neutral", "null"] as const).map((k) =>
          counts[k] ? <span key={k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flex: counts[k] / total, background: DIR[k].color }} /> : null,
        )}
      </div>
      <div className="mono mt-1 truncate text-[10px] text-ink-3">{cons ? cons.verdict : `${counts.positive}+ ${counts.neutral}~ ${counts.null}−`}</div>
    </div>
  );
});

export const RowNode = memo(function RowNode({ data }: NodeProps & { data: { row: Row; w: number } }) {
  const r = data.row;
  const d = r.dir ? DIR[r.dir] : null;
  return (
    <div
      className="pointer-events-none relative rounded-[10px]"
      style={{ width: data.w, height: r.h, background: d ? d.soft : "transparent", opacity: d ? 0.62 : 1 }}
    >
      {d && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full" style={{ background: d.color }} />}
      <div className="absolute left-4 top-2.5 w-[118px]">
        <div className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${d ? "" : "text-ink-3"}`} style={d ? { color: d.ink } : undefined}>
          {d && <span className="mono mr-1">{d.glyph}</span>}
          {r.label}
        </div>
        {r.hint && <div className="mt-0.5 text-[10.5px] leading-tight text-ink-3">{r.hint}</div>}
      </div>
    </div>
  );
});

export const nodeTypes = {
  substance: SubstanceNode,
  paper: PaperNode,
  author: AuthorNode,
  lab: LabNode,
  funder: FunderNode,
  claim: ClaimNode,
  outcome: OutcomeNode,
  row: RowNode,
};
