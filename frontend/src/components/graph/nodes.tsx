"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { balance } from "@/lib/store";
import type { Stance } from "@/lib/types";
import { useGraph } from "./context";
import { designShort, DIRECTION, Icon, STANCE, StanceGlyph, TONE } from "./glyphs";

type Data = { w: number; h: number; id?: string; key?: string; side?: Stance | null; shared?: boolean; stance?: string; count?: number; align?: string };

/** Every node gets a source and target handle on each side; edges pick the pair facing each other. */
const Handles = () => (
  <>
    {(["top", "right", "bottom", "left"] as const).map((p) => {
      const pos = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }[p];
      return (
        <span key={p}>
          <Handle id={`${p}-s`} type="source" position={pos} isConnectable={false} />
          <Handle id={`${p}-t`} type="target" position={pos} isConnectable={false} />
        </span>
      );
    })}
  </>
);

/** Node classes. Dimming, selection and the entry animation are styled from GraphCanvas's CSS. */
/**
 * Nodes render only from their data (and the graph context). React Flow also passes the live
 * position, which changes on every frame of a layout tween; ignoring it keeps nodes still while
 * they glide.
 */
function sameNode(a: NodeProps, b: NodeProps) {
  return a.data === b.data && a.id === b.id;
}

function nodeClass(base: string) {
  return `${base} tg-node`;
}

export function BalanceBar({ support, refute, mixed, className = "h-[6px]" }: { support: number; refute: number; mixed: number; className?: string }) {
  const parts: [Stance, number][] = [
    ["supports", support],
    ["mixed", mixed],
    ["refutes", refute],
  ];
  const any = support + refute + mixed > 0;
  return (
    <div className={`flex gap-[2px] overflow-hidden rounded-full bg-surface-3 ${className}`} aria-label={`${Math.round(support * 100)}% supports, ${Math.round(mixed * 100)}% mixed, ${Math.round(refute * 100)}% refutes`}>
      {any && parts.map(([k, v]) => (v > 0 ? <span key={k} className="h-full transition-[flex] duration-700" style={{ flex: v, background: STANCE[k].color }} /> : null))}
    </div>
  );
}

const STAGE: Record<string, string> = {
  discovery: "searching",
  stance: "judging stance",
  contradictions: "mapping conflicts",
  verdict: "writing verdict",
  done: "done",
};

export const HypothesisNode = memo(function HypothesisNode({ data }: NodeProps & { data: Data }) {
  const ctx = useGraph();
  const key = data.key!;
  const h = ctx.state.hyps[key];
  const v = ctx.state.verdicts[key];
  const b = balance(ctx.state, key);
  const tone = v ? TONE[v.tone] : null;
  const cls = nodeClass("rounded-xl border-2 bg-card px-4 py-3 shadow-[var(--shadow-md)]");
  return (
    <div className={cls} style={{ width: data.w, height: data.h, borderColor: tone?.color ?? "var(--ink)" }}>
      <Handles />
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Hypothesis H{ctx.hNum[key]}</span>
        {v ? (
          <Badge className="mono h-5 rounded-sm px-1.5 text-[10.5px]" style={{ background: tone!.color }}>
            {v.verdict} · {v.grade}
          </Badge>
        ) : (
          <span className="mono text-[10.5px] text-ink-3">{h?.reused ? "reused" : STAGE[h?.stage ?? "discovery"]}</span>
        )}
      </div>
      <div className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">{h?.statement}</div>
      <BalanceBar support={b.support} refute={b.refute} mixed={b.mixed} className="mt-2.5 h-[7px]" />
      <div className="mono mt-1 flex justify-between text-[10.5px] text-ink-3">
        <span style={{ color: STANCE.supports.ink }}>{Math.round(b.support * 100)}% supports</span>
        <span style={{ color: STANCE.refutes.ink }}>{Math.round(b.refute * 100)}% refutes</span>
      </div>
    </div>
  );
}, sameNode);

export const OtherHypNode = memo(function OtherHypNode({ data }: NodeProps & { data: Data }) {
  const ctx = useGraph();
  const h = ctx.state.hyps[data.key!];
  const cls = nodeClass("flex items-center gap-2 rounded-lg border border-dashed border-line-2 bg-surface-2 px-3 opacity-70 hover:opacity-100");
  return (
    <div className={cls} style={{ width: data.w, height: data.h }} title="Click to focus this hypothesis">
      <Handles />
      <span className="mono shrink-0 text-[10px] text-ink-3">H{ctx.hNum[data.key!]}</span>
      <span className="truncate text-[12px] text-ink-2">{h?.statement}</span>
    </div>
  );
}, sameNode);

export const QuestionNode = memo(function QuestionNode({ data }: NodeProps & { data: Data }) {
  const ctx = useGraph();
  const cls = nodeClass("rounded-lg bg-primary px-4 py-3 text-primary-foreground shadow-[var(--shadow-md)]");
  return (
    <div className={cls} style={{ width: data.w, height: data.h }}>
      <Handles />
      <div className="mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/60">Question</div>
      <div className="line-clamp-2 text-[14px] font-medium leading-tight">{ctx.state.question?.text}</div>
    </div>
  );
}, sameNode);

export const PaperNode = memo(function PaperNode({ data }: NodeProps & { data: Data }) {
  const ctx = useGraph();
  const p = ctx.state.papers[data.id!];
  const cls = nodeClass("relative rounded-lg border bg-card px-3 pb-2.5 pt-2.5 border-input shadow-[var(--shadow-sm)] hover:border-ink-3");
  if (!p) return null;
  const cred = p.credibility;
  const industry = p.funders.some((f) => f.type === "industry");
  const flags = (p.flags ?? []).filter((f) => f !== "funding-undisclosed").length;
  const also = ctx.focus ? Object.keys(p.considered).filter((k) => k !== ctx.focus && ctx.hNum[k]) : [];
  const sample = p.n ? `n=${p.n.toLocaleString()}` : p.kind === "registry" ? "registry" : "n=?";
  return (
    <div className={`${cls} ${industry ? "tg-hatch" : ""}`} style={{ width: data.w, height: data.h }}>
      <Handles />
      {(also.length > 0 || data.shared) && (
        <span className="mono absolute -top-2 right-2 rounded-full border border-ink-3 bg-surface px-1.5 text-[9px] text-ink-2">
          {data.shared ? "shared" : `also ${also.map((k) => `H${ctx.hNum[k]}`).join(" ")}`}
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate text-[13px] font-semibold leading-5 text-ink">{p.label}</div>
        <Badge variant="outline" className="mono mt-[2px] h-[15px] shrink-0 rounded-sm px-1 text-[9.5px] font-normal tracking-[0.04em] text-ink-2">
          {designShort(p.design)}
        </Badge>
      </div>
      <div className="mono mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10.5px] text-ink-3">
        <span className="tabular">{sample}</span>
        <span aria-hidden>·</span>
        <span className="tabular">{(p.citations ?? 0).toLocaleString()} cites</span>
        {p.year && (
          <>
            <span aria-hidden>·</span>
            <span>{p.year}</span>
          </>
        )}
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
          <span className="mono flex items-center gap-0.5 text-[10px] text-ink-3" title={`${flags} flag${flags > 1 ? "s" : ""}`}>
            <Icon name="flag" size={10} />
            {flags}
          </span>
        )}
      </div>
    </div>
  );
}, sameNode);

export const FindingNode = memo(function FindingNode({ data }: NodeProps & { data: Data }) {
  const ctx = useGraph();
  const f = ctx.state.findings[data.id!];
  const cls = nodeClass("relative overflow-hidden rounded-md border bg-surface pl-3 pr-2.5 py-2 shadow-[var(--shadow-sm)]");
  if (!f) return null;
  const e = ctx.focus ? f.evidence[ctx.focus] : null;
  const stance = (e?.stance ?? data.side ?? "mixed") as Stance;
  const cluster = e?.cluster ? ctx.state.clusters[e.cluster] : null;
  return (
    <div className={cls} style={{ width: data.w, height: data.h, borderColor: "var(--line-2)" }} title={f.quote}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: STANCE[stance].color }} />
      <Handles />
      <div className="flex items-start gap-2">
        <StanceGlyph stance={stance} size={16} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium leading-4 text-ink">{f.text}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
            <span className="mono">{DIRECTION[f.direction]?.arrow}</span>
            <span className="truncate">{f.outcome.name}</span>
            {cluster && <span className="mono shrink-0 truncate rounded-sm bg-surface-3 px-1 text-[9.5px]">{cluster.label}</span>}
            {f.harm && (
              <Badge variant="destructive" className="mono h-3.5 shrink-0 rounded-sm px-1 text-[9px] uppercase tracking-wider">
                harm
              </Badge>
            )}
            {f.quote_verified === false && (
              <span className="ml-auto flex shrink-0 items-center text-ink-3" title="Quote not found verbatim in the source">
                <Icon name="alert" size={10} />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, sameNode);

const LABELS: Record<string, { title: string; hint: string; color: string }> = {
  supports: { title: "Supports", hint: "evidence the hypothesis is true", color: STANCE.supports.ink },
  refutes: { title: "Refutes", hint: "evidence it is false, incl. null results", color: STANCE.refutes.ink },
  mixed: { title: "Mixed", hint: "partly supports, partly refutes", color: STANCE.mixed.ink },
  pending: { title: "Being read", hint: "found, not yet judged", color: "var(--ink-3)" },
  unused: { title: "No usable findings", hint: "read, but nothing measured for this hypothesis", color: "var(--ink-3)" },
};

export const LabelNode = memo(function LabelNode({ data }: NodeProps & { data: Data }) {
  const l = LABELS[data.stance!];
  const align = data.align === "right" ? "items-start" : data.align === "left" ? "items-end" : "items-center";
  return (
    <div className={`pointer-events-none flex flex-col ${align}`} style={{ width: data.w, height: data.h }}>
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: l.color }}>
        {l.title} <span className="mono font-normal">· {data.count}</span>
      </div>
      <div className="text-[10.5px] text-ink-3">{l.hint}</div>
    </div>
  );
}, sameNode);

export const nodeTypes = {
  question: QuestionNode,
  hypothesis: HypothesisNode,
  other: OtherHypNode,
  paper: PaperNode,
  finding: FindingNode,
  label: LabelNode,
};
