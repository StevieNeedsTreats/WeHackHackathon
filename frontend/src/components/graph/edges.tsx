"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import type { EdgeType } from "@/lib/types";
import { dimClass, useGraph } from "./context";

type Data = { type: EdgeType; reason?: string; severity?: string };

const STYLE: Record<EdgeType, { stroke: string; width: number; dash?: string; opacity: number }> = {
  STUDIED_IN: { stroke: "var(--line-2)", width: 1.2, opacity: 1 },
  AUTHORED_BY: { stroke: "var(--line-2)", width: 1, opacity: 1 },
  FROM_LAB: { stroke: "var(--line-2)", width: 1, opacity: 1 },
  FUNDED_BY: { stroke: "var(--ink-4)", width: 1, opacity: 0.9 },
  REPORTS: { stroke: "var(--ink-4)", width: 1.2, opacity: 0.9 },
  ABOUT: { stroke: "var(--ink-4)", width: 1, opacity: 0.45 },
  CITES: { stroke: "var(--ink-3)", width: 1, dash: "2 3", opacity: 0.7 },
  SUPPORTS: { stroke: "var(--pos)", width: 1.2, dash: "1 3", opacity: 0.75 },
  CONTRADICTS: { stroke: "var(--neg)", width: 1.6, dash: "6 4", opacity: 0.95 },
};

const r = 8; // corner radius for orthogonal routes

/** Orthogonal route: down to `midY`, across, then down to the target. */
function ortho(sx: number, sy: number, tx: number, ty: number, midY: number) {
  if (Math.abs(sx - tx) < 1) return `M${sx},${sy} L${tx},${ty}`;
  const dir = tx > sx ? 1 : -1;
  const rr = Math.min(r, Math.abs(tx - sx) / 2, Math.abs(midY - sy), Math.abs(ty - midY));
  return [
    `M${sx},${sy}`,
    `L${sx},${midY - rr}`,
    `Q${sx},${midY} ${sx + dir * rr},${midY}`,
    `L${tx - dir * rr},${midY}`,
    `Q${tx},${midY} ${tx},${midY + rr}`,
    `L${tx},${ty}`,
  ].join(" ");
}

export const VgEdge = memo(function VgEdge(props: EdgeProps & { data?: Data }) {
  const { id, sourceX, sourceY, targetX, targetY, data, sourcePosition, targetPosition } = props;
  const ctx = useGraph();
  const type = data?.type ?? "STUDIED_IN";
  const s = STYLE[type];
  const focused = ctx.active?.has(id);
  let path: string;
  let lx = (sourceX + targetX) / 2;
  let ly = (sourceY + targetY) / 2;

  switch (type) {
    case "STUDIED_IN":
      path = ortho(sourceX, sourceY, targetX, targetY, sourceY + 42);
      break;
    case "FUNDED_BY":
      path = ortho(sourceX, sourceY, targetX, targetY, targetY - 16);
      break;
    case "AUTHORED_BY":
    case "FROM_LAB":
    case "REPORTS":
      path = `M${sourceX},${sourceY} L${sourceX},${targetY}`;
      break;
    case "CITES": {
      const h = Math.min(150, 34 + Math.abs(targetX - sourceX) * 0.16);
      path = `M${sourceX},${sourceY} C${sourceX},${sourceY - h} ${targetX},${targetY - h} ${targetX},${targetY}`;
      ly = sourceY - h * 0.75;
      break;
    }
    case "CONTRADICTS":
    case "SUPPORTS": {
      const [p, x, y] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition: sourcePosition ?? Position.Right, targetPosition: targetPosition ?? Position.Left, curvature: 0.35 });
      path = p;
      lx = x;
      ly = y;
      break;
    }
    default: {
      const [p] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition: Position.Bottom, targetPosition: Position.Top, curvature: 0.3 });
      path = p;
    }
  }

  const fresh = ctx.fresh.has(id) && (type === "CONTRADICTS" || type === "CITES" || type === "SUPPORTS");
  return (
    <>
      <g className={`tg-edge ${dimClass(ctx, id)}`}>
        <BaseEdge
          id={id}
          path={path}
          className={fresh ? "tg-edge-draw" : ""}
          style={{
            stroke: focused && (type === "ABOUT" || type === "REPORTS") ? "var(--ink-2)" : s.stroke,
            strokeWidth: focused ? s.width + 0.6 : s.width,
            strokeDasharray: fresh ? undefined : s.dash,
            opacity: focused ? 1 : s.opacity,
            fill: "none",
          }}
        />
      </g>
      {type === "CONTRADICTS" && data?.reason && (focused || ctx.selected === id) && (
        <EdgeLabelRenderer>
          <div
            className="mono pointer-events-none absolute rounded-[4px] border bg-surface px-1.5 py-0.5 text-[10px] text-neg-ink shadow-[var(--shadow-sm)]"
            style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, borderColor: "var(--neg)" }}
          >
            {data.reason}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const edgeTypes = { tg: VgEdge };
export { STYLE as EDGE_STYLE };
