"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeChange } from "@xyflow/react";
import { Info, Maximize, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { allLayout, focusLayout, type EdgeKind, type LNode } from "@/lib/layout";
import { useLegend } from "@/lib/legend";
import type { State } from "@/lib/store";
import { GraphContext, LabelContext, type GraphCtx } from "./context";
import { EDGE_STYLE, edgeTypes } from "./edges";
import { STANCE } from "./glyphs";
import { nodeTypes } from "./nodes";
import { Tip } from "../Tip";

type Toggleable = "contradicts" | "cites" | "considered";
const TOGGLES: { kind: Toggleable; label: string }[] = [
  { kind: "contradicts", label: "Contradicts" },
  { kind: "cites", label: "Cites" },
  { kind: "considered", label: "Other hypotheses" },
];

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
type Box = { x: number; y: number; w: number; h: number };

/** Pick the pair of sides that face each other. */
function handles(a: Box | undefined, b: Box | undefined) {
  if (!a || !b) return { sourceHandle: "bottom-s", targetHandle: "top-t" };
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const horizontal = Math.abs(dx) - (a.w + b.w) / 4 > Math.abs(dy) - (a.h + b.h) / 4;
  if (horizontal) return dx > 0 ? { sourceHandle: "right-s", targetHandle: "left-t" } : { sourceHandle: "left-s", targetHandle: "right-t" };
  return dy > 0 ? { sourceHandle: "bottom-s", targetHandle: "top-t" } : { sourceHandle: "top-s", targetHandle: "bottom-t" };
}

interface Props {
  state: State;
  focus: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onFocus: (key: string) => void;
  highlight: string[] | null;
  empty?: React.ReactNode;
}

function Canvas({ state, focus, selected, onSelect, onFocus, highlight, empty }: Props) {
  const rf = useReactFlow();
  const layout = useMemo(() => (focus && state.hyps[focus] ? focusLayout(state, focus) : allLayout(state)), [state, focus]);
  const [show, setShow] = useState<Record<Toggleable, boolean>>({ contradicts: true, cites: false, considered: false });
  const [hover, setHover] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  // ---- position tween: nodes glide to new slots when the layout changes
  const target = useMemo(() => Object.fromEntries(layout.nodes.map((n) => [n.id, n])), [layout]);
  const display = useRef<Record<string, Box>>({});
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const from: Record<string, Box> = {};
    let moving = false;
    for (const [id, n] of Object.entries(target)) {
      const cur = display.current[id];
      if (!cur) display.current[id] = n;
      else if (cur.x !== n.x || cur.y !== n.y) {
        from[id] = cur;
        moving = true;
      } else display.current[id] = n;
    }
    for (const id of Object.keys(display.current)) if (!target[id]) delete display.current[id];
    if (!moving) {
      setFrame((f) => f + 1);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 480);
      const k = ease(t);
      for (const [id, a] of Object.entries(from)) {
        const b = target[id];
        if (b) display.current[id] = { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
      setFrame((f) => f + 1);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // ---- controlled flow: keep React Flow's measurements, or it re-hides nodes on every rebuild
  const measured = useRef<Record<string, { width: number; height: number }>>({});
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let changed = false;
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) {
        measured.current[c.id] = c.dimensions;
        changed = true;
      }
    }
    if (changed) setFrame((f) => f + 1);
  }, []);

  // ---- neighbourhood for hover / selection / insight refs
  const adjacency = useMemo(() => {
    const adj: Record<string, { node: string; edge: string; kind: EdgeKind }[]> = {};
    for (const e of layout.edges) {
      (adj[e.source] ??= []).push({ node: e.target, edge: e.id, kind: e.kind });
      (adj[e.target] ??= []).push({ node: e.source, edge: e.id, kind: e.kind });
    }
    return adj;
  }, [layout]);

  const kindOf = useCallback((id: string) => target[id]?.kind, [target]);
  const neighbourhood = useCallback(
    (seeds: string[]) => {
      const out = new Set<string>(seeds);
      for (const id of seeds) {
        for (const nb of adjacency[id] ?? []) {
          // Don't light up the whole graph through the hypothesis hub.
          if (kindOf(nb.node) === "hypothesis" && kindOf(id) !== "finding") continue;
          out.add(nb.edge);
          out.add(nb.node);
          if (kindOf(id) === "paper" && kindOf(nb.node) === "finding") {
            for (const nb2 of adjacency[nb.node] ?? []) {
              out.add(nb2.edge);
              out.add(nb2.node);
            }
          }
        }
      }
      return out;
    },
    [adjacency, kindOf],
  );

  // Exactly these findings: their papers, their evidence edges, and only the contradictions
  // *between* them (not every other conflict they take part in). Returns the contradiction
  // edges inside the set too, so a single pair can be labelled.
  const spotlight = useCallback(
    (seeds: string[]) => {
      const set = new Set(seeds.filter((id) => target[id]));
      if (!set.size) return null;
      const between: string[] = [];
      for (const id of [...set]) {
        for (const nb of adjacency[id] ?? []) {
          if (nb.kind === "contradicts") {
            if (set.has(nb.node)) between.push(nb.edge);
            continue;
          }
          if (nb.kind === "describes" || nb.kind === "evidence") {
            set.add(nb.edge);
            set.add(nb.node);
          }
        }
      }
      between.forEach((e) => set.add(e));
      return { set, between: [...new Set(between)] };
    },
    [adjacency, target],
  );

  const edgeEnds = useMemo(() => Object.fromEntries(layout.edges.map((e) => [e.id, [e.source, e.target]])), [layout]);
  const { active, labelled } = useMemo(() => {
    const valid = (id: string | null) => id && target[id] && target[id].kind !== "hypothesis" && target[id].kind !== "label";
    const pair = (id: string | null) => (id?.startsWith("c:") && edgeEnds[id] ? spotlight(edgeEnds[id]) : null);
    const lit = (s: { set: Set<string>; between: string[] } | null, label: boolean) =>
      s && { active: s.set, labelled: new Set(label ? s.between : []) };
    const none = { active: null, labelled: new Set<string>() };
    if (valid(hover)) return { active: neighbourhood([hover!]), labelled: new Set<string>() };
    const hovered = lit(pair(hover), true);
    if (hovered) return hovered;
    // Panel hover (insight, cluster, contradiction): label only a single pair, or labels pile up.
    if (highlight?.length) return lit(spotlight(highlight.map((f) => `f:${f}`)), highlight.length === 2) ?? none;
    if (valid(selected)) return { active: neighbourhood([selected!]), labelled: new Set<string>() };
    return lit(pair(selected), true) ?? none;
  }, [hover, highlight, selected, neighbourhood, spotlight, edgeEnds, target]);

  const hNum = useMemo(() => Object.fromEntries(state.hypOrder.map((k, i) => [k, i + 1])), [state.hypOrder]);
  const ctx: GraphCtx = useMemo(() => ({ state, focus, hNum }), [state, focus, hNum]);

  // Dimming and the selection ring as one generated rule keyed on React Flow's data-id
  // attributes: hovering rewrites this string instead of re-rendering every node and edge.
  const focusCss = useMemo(() => {
    const q = (id: string) => `[data-id="${id.replace(/["\\]/g, "\\$&")}"]`;
    let css = "";
    if (active?.size) {
      const lit = [...active].map(q).join(",");
      css += `.tg-flow .react-flow__node:not(${lit}),.tg-flow .react-flow__edge:not(${lit}){opacity:.18}`;
      css += `.tg-flow .react-flow__edge:is(${lit}) .react-flow__edge-path{opacity:1!important}`;
    }
    if (selected && target[selected]) css += `.tg-flow .react-flow__node${q(selected)} .tg-node{outline:2px solid var(--ink);outline-offset:2px}`;
    return css;
  }, [active, selected, target]);

  // ---- React Flow elements
  // Node data objects are created once per layout, so memoised nodes skip re-rendering while the
  // tween moves them (only `position` changes per frame) and when the user merely hovers.
  const nodeData = useMemo(() => Object.fromEntries(layout.nodes.map((n) => [n.id, { ...n.data, w: n.w, h: n.h }])), [layout]);
  const nodes: Node[] = useMemo(
    () =>
      layout.nodes
        .filter((n) => display.current[n.id])
        .map((n: LNode) => {
          const p = display.current[n.id];
          return {
            id: n.id,
            type: n.kind,
            position: { x: p.x, y: p.y },
            data: nodeData[n.id],
            measured: measured.current[n.id],
            draggable: false,
            selectable: n.kind !== "label",
            // The hypothesis sits above everything, contradiction lines included: they span the
            // canvas between findings and must never cover its title or verdict.
            zIndex: n.kind === "finding" ? 2 : n.kind === "hypothesis" ? 5 : 1,
          };
        }),
    // `frame` advances whenever display positions or measurements (both refs) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, nodeData, frame],
  );
  const edges: Edge[] = useMemo(
    () =>
      layout.edges
        .filter((e) => target[e.source] && target[e.target])
        .filter((e) => !(e.kind in show) || show[e.kind as Toggleable])
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: "tg",
          ...handles(target[e.source], target[e.target]),
          data: { kind: e.kind, stance: e.stance, weight: e.weight, reason: e.reason, severity: e.severity, explained: e.explained },
          zIndex: e.kind === "contradicts" ? 4 : 0,
          selectable: e.kind === "contradicts",
        })),
    [layout, show, target],
  );

  // ---- follow the build: keep the whole graph in view while it grows
  const boundsRef = useRef(layout.bounds);
  useLayoutEffect(() => {
    boundsRef.current = layout.bounds;
  }, [layout.bounds]);
  const fit = useCallback(
    (duration: number) => {
      const b = boundsRef.current;
      rf.fitBounds({ x: b.x - 30, y: b.y - 30, width: b.w + 60, height: b.h + 60 }, { padding: 0.04, duration });
    },
    [rf],
  );
  const lastFit = useRef(0);
  const sig = `${Math.round(layout.bounds.w / 60)}:${Math.round(layout.bounds.h / 60)}:${focus}`;
  useEffect(() => {
    if (!follow || !layout.nodes.length) return;
    const wait = Math.max(0, 650 - (Date.now() - lastFit.current));
    const t = setTimeout(() => {
      lastFit.current = Date.now();
      fit(520);
    }, wait + 60);
    return () => clearTimeout(t);
  }, [sig, follow, fit, layout.nodes.length]);
  // Switching hypothesis re-enables following (adjusted during render, not in an effect).
  const [followFor, setFollowFor] = useState(focus);
  if (followFor !== focus) {
    setFollowFor(focus);
    setFollow(true);
  }

  // Refit when the canvas itself resizes (side panels collapsing, window resize) while following.
  const box = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  useLayoutEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => followRef.current && fit(300), 240);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [fit]);

  const isEmpty = !state.question;

  return (
    <GraphContext.Provider value={ctx}>
      <LabelContext.Provider value={labelled}>
      <style>{focusCss}</style>
      <div ref={box} className="tg-flow relative h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.1}
          maxZoom={2}
          onlyRenderVisibleElements={nodes.length > 300}
          onNodesChange={onNodesChange}
          nodesConnectable={false}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
          onNodeMouseEnter={(_, n) => n.type !== "label" && n.type !== "hypothesis" && setHover(n.id)}
          onNodeMouseLeave={() => setHover(null)}
          onNodeClick={(_, n) => {
            if (n.type === "other" || (n.type === "hypothesis" && !focus)) onFocus((n.data as { key: string }).key);
            else if (n.type !== "label") onSelect(n.id);
          }}
          onEdgeClick={(_, e) => onSelect(e.id)}
          onEdgeMouseEnter={(_, e) => e.data?.kind === "contradicts" && setHover(e.id)}
          onEdgeMouseLeave={() => setHover(null)}
          onPaneClick={() => onSelect(null)}
          onMoveStart={(ev) => {
            if (ev) setFollow(false);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--grid-dot)" />
        </ReactFlow>

        {isEmpty && <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{empty}</div>}

        {!isEmpty && (
          <>
            <Legend show={show} setShow={setShow} />
            <Card size="sm" className="absolute bottom-4 left-4 flex-row items-center gap-1 p-1 shadow-[var(--shadow-sm)]">
              <Tip label="Zoom in">
                <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: 200 })}>
                  <Plus />
                </Button>
              </Tip>
              <Tip label="Zoom out">
                <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: 200 })}>
                  <Minus />
                </Button>
              </Tip>
              <Tip label="Fit whole graph">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Fit graph"
                  onClick={() => {
                    setFollow(true);
                    fit(400);
                  }}
                >
                  <Maximize />
                </Button>
              </Tip>
              <Separator orientation="vertical" className="mx-0.5 h-4 self-center" />
              <Tip label="Keep the whole graph in view while it builds">
                <Toggle size="sm" pressed={follow} onPressedChange={setFollow} className="mono text-[10.5px] aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/85">
                  follow build
                </Toggle>
              </Tip>
            </Card>
          </>
        )}
      </div>
      </LabelContext.Provider>
    </GraphContext.Provider>
  );
}

function Legend({ show, setShow }: { show: Record<Toggleable, boolean>; setShow: (f: (s: Record<Toggleable, boolean>) => Record<Toggleable, boolean>) => void }) {
  const on = TOGGLES.filter((t) => show[t.kind]).map((t) => t.kind);
  const [open, setOpen] = useLegend();
  if (!open)
    return (
      <Button variant="outline" size="sm" className="absolute left-4 top-4 h-7 gap-1.5 bg-card/95 px-2.5 text-[12px] font-normal shadow-[var(--shadow-sm)] backdrop-blur" onClick={() => setOpen(true)}>
        <Info className="size-3.5" />
        Legend
      </Button>
    );
  return (
    <Card size="sm" className="absolute left-4 top-4 max-w-[calc(100%-2rem)] gap-2 bg-card/95 py-2.5 pl-3 pr-9 shadow-[var(--shadow-sm)] backdrop-blur">
      <Tip label="Hide legend">
        <Button variant="ghost" size="icon-xs" aria-label="Hide legend" className="absolute right-1.5 top-1.5 text-muted-foreground" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </Tip>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11.5px] text-ink-2">
        {(["supports", "mixed", "refutes"] as const).map((d) => (
          <span key={d} className="flex items-center gap-1.5">
            <span className="mono flex size-3.5 items-center justify-center rounded-full text-[9px] text-card" style={{ background: STANCE[d].color }}>
              {STANCE[d].glyph}
            </span>
            {STANCE[d].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="tg-hatch h-3 w-4 rounded-[3px] border border-ink-3" />
          Industry funded
        </span>
        <span className="text-ink-3">edge width = credibility × relevance</span>
      </div>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        spacing={1}
        value={on}
        onValueChange={(v) => setShow(() => Object.fromEntries(TOGGLES.map((t) => [t.kind, v.includes(t.kind)])) as Record<Toggleable, boolean>)}
        className="hidden flex-wrap sm:flex"
        aria-label="Show relationships"
      >
        {TOGGLES.map((t) => {
          const st = EDGE_STYLE[t.kind];
          return (
            <ToggleGroupItem
              key={t.kind}
              value={t.kind}
              className="h-6 rounded-full px-2 text-[11px] font-normal text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground"
            >
              <svg width="18" height="6" aria-hidden>
                <line x1="1" y1="3" x2="17" y2="3" stroke={st.stroke} strokeWidth={Math.max(1.4, st.width)} strokeDasharray={st.dash} opacity={show[t.kind] ? 1 : 0.35} />
              </svg>
              {t.label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </Card>
  );
}

export default function GraphCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
