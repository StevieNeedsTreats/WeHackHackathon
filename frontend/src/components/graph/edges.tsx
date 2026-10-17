"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { memo, useContext } from "react";
import type { EdgeKind } from "@/lib/layout";
import type { Stance } from "@/lib/types";
import { LabelContext } from "./context";
import { STANCE } from "./glyphs";

type Data = { kind: EdgeKind; stance?: Stance; weight?: number; reason?: string; severity?: string; explained?: string | null };

export const EDGE_STYLE: Record<EdgeKind, { stroke: string; width: number; dash?: string; opacity: number }> = {
  evidence: { stroke: "var(--ink-3)", width: 1.4, opacity: 0.85 },
  describes: { stroke: "var(--line-2)", width: 1.2, opacity: 1 },
  considered: { stroke: "var(--ink-4)", width: 1, dash: "3 4", opacity: 0.6 },
  cites: { stroke: "var(--ink-3)", width: 1, dash: "2 3", opacity: 0.7 },
  contradicts: { stroke: "var(--neg)", width: 1.6, dash: "6 4", opacity: 0.95 },
};

export const VgEdge = memo(function VgEdge(props: EdgeProps & { data?: Data }) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const kind = data?.kind ?? "describes";
  const s = EDGE_STYLE[kind];
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: kind === "contradicts" ? 0.5 : 0.3 });
  let stroke = s.stroke;
  let width = s.width;
  if (kind === "evidence" && data?.stance) {
    stroke = STANCE[data.stance].color;
    width = 1 + (data.weight ?? 0.3) * 3.2;
  }
  if (kind === "contradicts" && data?.explained) stroke = "var(--ink-3)";
  return (
    <>
      <g className="tg-edge">
        <BaseEdge
          id={id}
          path={path}
          className={kind === "evidence" ? "tg-edge-draw" : ""}
          style={{ stroke, strokeWidth: width, strokeDasharray: s.dash, opacity: s.opacity, fill: "none" }}
        />
      </g>
      {kind === "contradicts" && data?.reason && <ContradictionLabel id={id} x={lx} y={ly} stroke={stroke} reason={data.reason} explained={data.explained} />}
    </>
  );
});

/** Only contradiction edges read the label set, so changing it re-renders just these. */
function ContradictionLabel({ id, x, y, stroke, reason, explained }: { id: string; x: number; y: number; stroke: string; reason: string; explained?: string | null }) {
  const labelled = useContext(LabelContext);
  if (!labelled.has(id)) return null;
  return (
        <EdgeLabelRenderer>
          <div
            className="mono pointer-events-none absolute max-w-[220px] rounded-[4px] border bg-surface px-1.5 py-0.5 text-[10px] shadow-[var(--shadow-sm)]"
            style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)`, borderColor: stroke, color: explained ? "var(--ink-2)" : "var(--neg-ink)" }}
          >
            {reason}
            {explained && <span className="block text-ink-3">{explained.toLowerCase() !== reason.toLowerCase() ? `explained: ${explained}` : "explained"}</span>}
          </div>
        </EdgeLabelRenderer>
  );
}

export const edgeTypes = { tg: VgEdge };
