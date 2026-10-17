"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeLayout, GUTTER, type Placed } from "@/lib/layout";
import type { State } from "@/lib/store";
import type { Consensus, EdgeType, GEdge } from "@/lib/types";
import { GraphContext, type GraphCtx } from "./context";
import { EDGE_STYLE, edgeTypes } from "./edges";
import { DIR } from "./glyphs";
import { nodeTypes } from "./nodes";

type Toggleable = "CONTRADICTS" | "SUPPORTS" | "CITES" | "FUNDED_BY" | "ABOUT";
const TOGGLES: { type: Toggleable; label: string }[] = [
  { type: "CONTRADICTS", label: "Contradicts" },
  { type: "SUPPORTS", label: "Supports" },
  { type: "CITES", label: "Cites" },
  { type: "FUNDED_BY", label: "Funded by" },
  { type: "ABOUT", label: "About outcome" },
];

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function handlesFor(e: GEdge, pos: Record<string, Placed>): { sourceHandle: string; targetHandle: string } {
  switch (e.type) {
    case "STUDIED_IN":
      return { sourceHandle: "b", targetHandle: "top" };
    case "AUTHORED_BY":
    case "FROM_LAB":
    case "FUNDED_BY":
      return { sourceHandle: "meta", targetHandle: "top" };
    case "REPORTS":
      return { sourceHandle: "spine", targetHandle: "spine" };
    case "ABOUT":
      return { sourceHandle: "b", targetHandle: "top" };
    case "CITES":
      return { sourceHandle: "arc-s", targetHandle: "arc-t" };
    default: {
      const right = (pos[e.target]?.x ?? 0) >= (pos[e.source]?.x ?? 0);
      return right ? { sourceHandle: "r-s", targetHandle: "l-t" } : { sourceHandle: "l-s", targetHandle: "r-t" };
    }
  }
}

interface Props {
  state: State;
  selected: string | null;
  onSelect: (id: string | null) => void;
  highlight: string[] | null;
  empty?: React.ReactNode;
}

function Canvas({ state, selected, onSelect, highlight, empty }: Props) {
  const rf = useReactFlow();
  const layout = useMemo(() => computeLayout(state.nodes, state.edges, state.order), [state.nodes, state.edges, state.order]);
  const [show, setShow] = useState<Record<Toggleable, boolean>>({ CONTRADICTS: true, SUPPORTS: false, CITES: true, FUNDED_BY: true, ABOUT: true });
  const [hover, setHover] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  // ---- position tween: nodes glide to new slots when papers re-sort by credibility
  const display = useRef<Record<string, Placed>>({});
  const [, setFrame] = useState(0);
  useEffect(() => {
    const from: Record<string, Placed> = {};
    const to = layout.pos;
    let moving = false;
    for (const id of Object.keys(to)) {
      const cur = display.current[id];
      if (!cur) display.current[id] = to[id];
      else if (cur.x !== to[id].x || cur.y !== to[id].y) {
        from[id] = cur;
        moving = true;
      } else display.current[id] = to[id];
    }
    for (const id of Object.keys(display.current)) if (!to[id]) delete display.current[id];
    if (!moving) {
      setFrame((f) => f + 1);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 460);
      const k = ease(t);
      for (const [id, a] of Object.entries(from)) {
        const b = to[id];
        if (b) display.current[id] = { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
      setFrame((f) => f + 1);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  // ---- entry animations for ids that just arrived
  const known = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const ids = [...Object.keys(state.nodes), ...Object.keys(state.edges)];
    if (ids.length < known.current.size) known.current = new Set();
    const added = ids.filter((id) => !known.current.has(id));
    if (!added.length) return;
    added.forEach((id) => known.current.add(id));
    setFresh((f) => new Set([...f, ...added]));
    // Not cancelled on the next batch: each batch's ids expire on their own clock.
    const t = setTimeout(() => {
      timers.current.delete(t);
      setFresh((f) => {
        const n = new Set(f);
        added.forEach((id) => n.delete(id));
        return n;
      });
    }, 900);
    timers.current.add(t);
  }, [state.nodes, state.edges]);
  useEffect(() => {
    const ts = timers.current;
    return () => ts.forEach(clearTimeout);
  }, []);

  // ---- neighbourhood for hover / selection / insight refs
  const adjacency = useMemo(() => {
    const adj: Record<string, { node: string; edge: string; type: EdgeType }[]> = {};
    for (const e of Object.values(state.edges)) {
      if (e.type === "STUDIED_IN") continue;
      (adj[e.source] ??= []).push({ node: e.target, edge: e.id, type: e.type });
      (adj[e.target] ??= []).push({ node: e.source, edge: e.id, type: e.type });
    }
    return adj;
  }, [state.edges]);

  const neighbourhood = useCallback(
    (seeds: string[], depth: number) => {
      const out = new Set<string>(seeds);
      let frontier = seeds;
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const nb of adjacency[id] ?? []) {
            // Don't fan out through shared hubs (outcomes, funders) on the second hop.
            if (d > 0 && (nb.type === "ABOUT" || nb.type === "FUNDED_BY" || nb.type === "SUPPORTS" || nb.type === "CONTRADICTS") && state.nodes[id]?.kind !== "claim") continue;
            out.add(nb.edge);
            if (!out.has(nb.node)) {
              out.add(nb.node);
              next.push(nb.node);
            }
          }
        }
        frontier = next;
      }
      return out;
    },
    [adjacency, state.nodes],
  );

  const active = useMemo(() => {
    if (hover) return neighbourhood([hover], state.nodes[hover]?.kind === "claim" ? 1 : 2);
    if (highlight?.length) return neighbourhood(highlight, 1);
    if (selected && state.nodes[selected]) return neighbourhood([selected], state.nodes[selected].kind === "claim" ? 1 : 2);
    return null;
  }, [hover, highlight, selected, neighbourhood, state.nodes]);

  const consensus = useMemo(() => {
    const m: Record<string, Consensus> = {};
    for (const c of state.insights?.consensus ?? []) m[`o:${c.outcome_key}`] = c;
    return m;
  }, [state.insights]);

  const ctx: GraphCtx = useMemo(() => ({ active, selected, consensus, fresh }), [active, selected, consensus, fresh]);

  // ---- React Flow elements
  const hasPapers = Object.values(state.nodes).some((n) => n.kind === "paper");
  const rows: Node[] = (hasPapers ? layout.rows : []).map((r) => ({
    id: r.id,
    type: "row",
    position: { x: -GUTTER, y: r.y },
    data: { row: r, w: layout.width + GUTTER + 36 },
    width: layout.width + GUTTER + 36,
    height: r.h,
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: -1,
  }));
  const nodes: Node[] = rows.concat(
    Object.values(state.nodes)
      .filter((n) => display.current[n.id])
      .map((n) => {
        const p = display.current[n.id];
        return { id: n.id, type: n.kind, position: { x: p.x, y: p.y }, data: { n, w: p.w, h: p.h }, width: p.w, height: p.h, draggable: false, zIndex: n.kind === "claim" ? 2 : 1 };
      }),
  );
  const edges: Edge[] = Object.values(state.edges)
    .filter((e) => display.current[e.source] && display.current[e.target])
    .filter((e) => !(e.type in show) || show[e.type as Toggleable])
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "tg",
      ...handlesFor(e, layout.pos),
      data: { type: e.type, reason: e.reason, severity: e.severity },
      zIndex: e.type === "CONTRADICTS" || e.type === "SUPPORTS" ? 3 : 0,
      selectable: e.type === "CONTRADICTS",
    }));

  // ---- follow the build: keep the whole graph in view while it grows
  const lastFit = useRef(0);
  const bounds = `${Math.round(layout.width / 50)}:${Math.round(layout.height / 50)}`;
  useEffect(() => {
    if (!follow || !Object.keys(state.nodes).length) return;
    const now = Date.now();
    const wait = Math.max(0, 650 - (now - lastFit.current));
    const t = setTimeout(() => {
      lastFit.current = Date.now();
      rf.fitView({ padding: 0.06, duration: 520, maxZoom: 1.05 });
    }, wait + 60);
    return () => clearTimeout(t);
  }, [bounds, follow, rf, state.status, state.nodes]);

  const empty_ = !Object.keys(state.nodes).length;

  return (
    <GraphContext.Provider value={ctx}>
      <div className="relative h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.12}
          maxZoom={2}
          onlyRenderVisibleElements={nodes.length > 400}
          nodesConnectable={false}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
          onNodeMouseEnter={(_, n) => n.type !== "row" && n.type !== "substance" && setHover(n.id)}
          onNodeMouseLeave={() => setHover(null)}
          onNodeClick={(_, n) => n.type !== "row" && onSelect(n.id)}
          onEdgeClick={(_, e) => onSelect(e.id)}
          onPaneClick={() => onSelect(null)}
          onMoveStart={(ev) => {
            if (ev) setFollow(false);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#dcd8ce" />
        </ReactFlow>

        {empty_ && <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{empty}</div>}

        {!empty_ && (
          <>
            <Legend show={show} setShow={setShow} />
            <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-[8px] border border-line bg-surface p-1 shadow-[var(--shadow-sm)]">
              <CanvasBtn label="Zoom in" onClick={() => rf.zoomIn({ duration: 200 })}>+</CanvasBtn>
              <CanvasBtn label="Zoom out" onClick={() => rf.zoomOut({ duration: 200 })}>−</CanvasBtn>
              <CanvasBtn
                label="Fit graph"
                onClick={() => {
                  setFollow(true);
                  rf.fitView({ padding: 0.06, duration: 400, maxZoom: 1.05 });
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
                </svg>
              </CanvasBtn>
              <span className="mx-1 h-4 w-px bg-line" />
              <button
                onClick={() => setFollow((f) => !f)}
                className={`mono rounded-[5px] px-2 py-1 text-[10.5px] ${follow ? "bg-ink text-white" : "text-ink-2 hover:bg-surface-3"}`}
                aria-pressed={follow}
              >
                follow build
              </button>
            </div>
          </>
        )}
      </div>
    </GraphContext.Provider>
  );
}

function CanvasBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[15px] text-ink-2 hover:bg-surface-3 hover:text-ink">
      {children}
    </button>
  );
}

function Legend({ show, setShow }: { show: Record<Toggleable, boolean>; setShow: (f: (s: Record<Toggleable, boolean>) => Record<Toggleable, boolean>) => void }) {
  return (
    <div className="absolute left-4 top-4 max-w-[calc(100%-2rem)] rounded-[10px] border border-line bg-surface/95 px-3 py-2.5 shadow-[var(--shadow-sm)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11.5px] text-ink-2">
        {(["positive", "neutral", "null"] as const).map((d) => (
          <span key={d} className="flex items-center gap-1.5">
            <span className="mono flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] text-white" style={{ background: DIR[d].color }}>
              {DIR[d].glyph}
            </span>
            {DIR[d].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="tg-hatch h-3 w-4 rounded-[3px] border border-ink-3" />
          Industry funded
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {TOGGLES.map((t) => {
          const s = EDGE_STYLE[t.type];
          const on = show[t.type];
          return (
            <button
              key={t.type}
              onClick={() => setShow((x) => ({ ...x, [t.type]: !x[t.type] }))}
              aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] transition-colors ${on ? "border-line-2 bg-surface text-ink" : "border-transparent bg-surface-3 text-ink-3 line-through decoration-ink-4"}`}
            >
              <svg width="18" height="6" aria-hidden>
                <line x1="1" y1="3" x2="17" y2="3" stroke={s.stroke} strokeWidth={Math.max(1.4, s.width)} strokeDasharray={s.dash} opacity={on ? 1 : 0.4} />
              </svg>
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function GraphCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
