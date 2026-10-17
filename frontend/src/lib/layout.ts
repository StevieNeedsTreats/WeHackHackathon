import type { State } from "./store";
import type { Finding, Paper, Stance } from "./types";

/**
 * Two layouts.
 *
 * Focus (one hypothesis), "tug of war": the hypothesis sits in the middle, supporting
 * findings and their papers pull from the left, refuting ones from the right, mixed
 * findings hang below. Each side is sorted by credibility. Papers still waiting to be
 * read or judged queue above.
 *
 * All: the question on top, its hypotheses below, and every paper underneath, linked to
 * each hypothesis it was considered for.
 */
export const HYP_W = 320;
export const HYP_H = 132;
export const PAPER_W = 196;
export const PAPER_H = 92;
export const FIND_W = 212;
export const FIND_H = 62;
const GAP = 12;
const SIDE_GAP = 96; // hypothesis ↔ findings column
const LINK_GAP = 46; // findings ↔ papers column

export type NodeKind = "question" | "hypothesis" | "other" | "paper" | "finding" | "label";

export interface LNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  data: Record<string, unknown>;
}

export type EdgeKind = "evidence" | "describes" | "contradicts" | "cites" | "considered";

export interface LEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  stance?: Stance;
  weight?: number;
  reason?: string;
  severity?: string;
  explained?: string | null;
}

export interface Layout {
  nodes: LNode[];
  edges: LEdge[];
  bounds: { x: number; y: number; w: number; h: number };
}

const SIDES: Stance[] = ["supports", "refutes", "mixed"];

function dominant(p: Paper, fs: Finding[], key: string): Stance | null {
  const w: Record<Stance, number> = { supports: 0, refutes: 0, mixed: 0 };
  let any = false;
  for (const f of fs) {
    const e = f.evidence[key];
    if (!e) continue;
    w[e.stance] += e.weight + 0.001;
    any = true;
  }
  if (!any) return null;
  return SIDES.reduce((a, b) => (w[b] > w[a] ? b : a));
}

function bounds(nodes: LNode[]) {
  if (!nodes.length) return { x: -200, y: -100, w: 400, h: 200 };
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.w));
  const y1 = Math.max(...nodes.map((n) => n.y + n.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function grid(ids: string[], cx: number, y: number, cols: number, w: number, h: number) {
  const out: { id: string; x: number; y: number }[] = [];
  const n = Math.min(cols, ids.length);
  const rowW = n * w + (n - 1) * GAP;
  ids.forEach((id, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    out.push({ id, x: cx - rowW / 2 + c * (w + GAP), y: y + r * (h + GAP) });
  });
  return out;
}

export function focusLayout(s: State, key: string): Layout {
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  const hyp = s.hyps[key];
  if (!hyp) return { nodes, edges, bounds: bounds(nodes) };

  const papers = s.paperOrder.map((id) => s.papers[id]).filter((p) => p?.considered[key]);
  const byPaper: Record<string, Finding[]> = {};
  for (const f of Object.values(s.findings)) (byPaper[f.paper_id] ??= []).push(f);
  const cred = (p: Paper) => p.credibility ?? -1;

  // Which side each paper sits on, and each judged finding's side.
  const side: Record<string, Stance | null> = {};
  for (const p of papers) side[p.id] = dominant(p, byPaper[p.id] ?? [], key);
  const pending = papers.filter((p) => side[p.id] == null).sort((a, b) => cred(b) - cred(a));

  // Slots per side: a paper with its findings of that stance, or orphan findings whose paper sits elsewhere.
  type Slot = { paper?: Paper; findings: Finding[] };
  const slots: Record<Stance, Slot[]> = { supports: [], refutes: [], mixed: [] };
  for (const st of SIDES) {
    const own = papers.filter((p) => side[p.id] === st).sort((a, b) => cred(b) - cred(a));
    for (const p of own) slots[st].push({ paper: p, findings: (byPaper[p.id] ?? []).filter((f) => f.evidence[key]?.stance === st) });
    const orphans = papers
      .filter((p) => side[p.id] && side[p.id] !== st)
      .flatMap((p) => (byPaper[p.id] ?? []).filter((f) => f.evidence[key]?.stance === st));
    if (orphans.length) slots[st].push({ findings: orphans });
  }

  const slotH = (sl: Slot) => Math.max(sl.paper ? PAPER_H : 0, sl.findings.length * (FIND_H + 8) - 8);
  const colH = (st: Stance) => slots[st].reduce((a, sl) => a + slotH(sl) + GAP * 2, 0);
  const sideH = Math.max(colH("supports"), colH("refutes"), HYP_H);
  const hypY = sideH / 2 - HYP_H / 2;

  nodes.push({ id: `h:${key}`, kind: "hypothesis", x: -HYP_W / 2, y: hypY, w: HYP_W, h: HYP_H, data: { key } });

  // Left (supports) and right (refutes).
  for (const st of ["supports", "refutes"] as const) {
    const left = st === "supports";
    const fx = left ? -HYP_W / 2 - SIDE_GAP - FIND_W : HYP_W / 2 + SIDE_GAP;
    const px = left ? fx - LINK_GAP - PAPER_W : fx + FIND_W + LINK_GAP;
    let y = sideH / 2 - colH(st) / 2;
    const count = slots[st].reduce((a, sl) => a + sl.findings.length, 0);
    nodes.push({ id: `label:${st}`, kind: "label", x: left ? px : fx, y: Math.min(y, 0) - 44, w: PAPER_W + LINK_GAP + FIND_W, h: 30, data: { stance: st, count, align: left ? "left" : "right" } });
    for (const sl of slots[st]) {
      const h = slotH(sl);
      if (sl.paper) nodes.push({ id: `p:${sl.paper.id}`, kind: "paper", x: px, y: y + GAP + (h - PAPER_H) / 2, w: PAPER_W, h: PAPER_H, data: { id: sl.paper.id, side: st } });
      const fy0 = y + GAP + (h - (sl.findings.length * (FIND_H + 8) - 8)) / 2;
      sl.findings.forEach((f, i) => nodes.push({ id: `f:${f.id}`, kind: "finding", x: fx, y: fy0 + i * (FIND_H + 8), w: FIND_W, h: FIND_H, data: { id: f.id, side: st } }));
      y += h + GAP * 2;
    }
  }

  // Mixed hangs below.
  let bottom = Math.max(sideH, hypY + HYP_H) + 70;
  const mixed = slots.mixed;
  if (mixed.length) {
    const fids = mixed.flatMap((sl) => sl.findings);
    nodes.push({ id: "label:mixed", kind: "label", x: -HYP_W / 2, y: bottom - 40, w: HYP_W, h: 30, data: { stance: "mixed", count: fids.length, align: "center" } });
    const cols = Math.max(1, Math.min(5, fids.length));
    const fpos = grid(fids.map((f) => f.id), 0, bottom, cols, FIND_W, FIND_H);
    fpos.forEach((p) => nodes.push({ id: `f:${p.id}`, kind: "finding", x: p.x, y: p.y, w: FIND_W, h: FIND_H, data: { id: p.id, side: "mixed" } }));
    bottom = Math.max(...fpos.map((p) => p.y)) + FIND_H + 46;
    const mpapers = mixed.filter((sl) => sl.paper).map((sl) => sl.paper!.id);
    const ppos = grid(mpapers, 0, bottom, 5, PAPER_W, PAPER_H);
    ppos.forEach((p) => nodes.push({ id: `p:${p.id}`, kind: "paper", x: p.x, y: p.y, w: PAPER_W, h: PAPER_H, data: { id: p.id, side: "mixed" } }));
  }

  // Waiting papers queue above; other hypotheses sit dimmed above that.
  let top = Math.min(0, ...nodes.filter((n) => n.kind === "label").map((n) => n.y)) - 40;
  if (pending.length) {
    const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(pending.length * 2))));
    const rows = Math.ceil(pending.length / cols);
    top -= rows * (PAPER_H + GAP);
    nodes.push({ id: "label:pending", kind: "label", x: -HYP_W / 2, y: top - 40, w: HYP_W, h: 30, data: { stance: "pending", count: pending.length, align: "center" } });
    grid(pending.map((p) => p.id), 0, top, cols, PAPER_W, PAPER_H).forEach((p) =>
      nodes.push({ id: `p:${p.id}`, kind: "paper", x: p.x, y: p.y, w: PAPER_W, h: PAPER_H, data: { id: p.id, side: null } }),
    );
    top -= 80;
  }
  const others = s.hypOrder.filter((k) => k !== key);
  others.forEach((k, i) => {
    const w = 250;
    const x = -((others.length * (w + 16) - 16) / 2) + i * (w + 16);
    nodes.push({ id: `h:${k}`, kind: "other", x, y: top - 60, w, h: 48, data: { key: k } });
  });

  // Edges.
  const placed = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    if (n.kind !== "finding") continue;
    const f = s.findings[n.data.id as string];
    const e = f.evidence[key];
    edges.push({ id: `ev:${f.id}`, source: n.id, target: `h:${key}`, kind: "evidence", stance: e.stance, weight: e.weight });
    if (placed.has(`p:${f.paper_id}`)) edges.push({ id: `d:${f.id}`, source: `p:${f.paper_id}`, target: n.id, kind: "describes" });
  }
  for (const c of s.contradictions[key] ?? []) {
    if (placed.has(`f:${c.a}`) && placed.has(`f:${c.b}`))
      edges.push({ id: `c:${c.a}:${c.b}`, source: `f:${c.a}`, target: `f:${c.b}`, kind: "contradicts", reason: c.reason, severity: c.severity, explained: c.explained_by });
  }
  for (const [a, b] of s.cites) if (placed.has(`p:${a}`) && placed.has(`p:${b}`)) edges.push({ id: `ci:${a}:${b}`, source: `p:${a}`, target: `p:${b}`, kind: "cites" });
  for (const k of others) {
    for (const p of papers) if (p.considered[k] && placed.has(`p:${p.id}`)) edges.push({ id: `o:${k}:${p.id}`, source: `h:${k}`, target: `p:${p.id}`, kind: "considered" });
  }

  return { nodes, edges, bounds: bounds(nodes) };
}

export function allLayout(s: State): Layout {
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  if (!s.question) return { nodes, edges, bounds: bounds(nodes) };
  nodes.push({ id: "q", kind: "question", x: -200, y: 0, w: 400, h: 70, data: {} });
  const keys = s.hypOrder;
  const hw = HYP_W;
  keys.forEach((k, i) => {
    const x = -((keys.length * (hw + 60) - 60) / 2) + i * (hw + 60);
    nodes.push({ id: `h:${k}`, kind: "hypothesis", x, y: 150, w: hw, h: HYP_H, data: { key: k } });
    edges.push({ id: `q:${k}`, source: "q", target: `h:${k}`, kind: "considered" });
  });

  // Papers grouped by the hypotheses they inform: each group sits under the mean x of its hypotheses.
  const hx = Object.fromEntries(nodes.filter((n) => n.kind === "hypothesis").map((n) => [n.data.key as string, n.x + n.w / 2]));
  const groups: Record<string, Paper[]> = {};
  for (const id of s.paperOrder) {
    const p = s.papers[id];
    if (!p) continue;
    const ks = keys.filter((k) => p.considered[k]);
    if (!ks.length) continue;
    (groups[ks.join("|")] ??= []).push(p);
  }
  const y0 = 150 + HYP_H + 120;
  const ordered = Object.entries(groups).sort(([a], [b]) => {
    const ma = a.split("|").reduce((t, k) => t + hx[k], 0) / a.split("|").length;
    const mb = b.split("|").reduce((t, k) => t + hx[k], 0) / b.split("|").length;
    return ma - mb;
  });
  let cursor = -Infinity;
  for (const [g, ps] of ordered) {
    const ks = g.split("|");
    const cx = ks.reduce((t, k) => t + hx[k], 0) / ks.length;
    ps.sort((a, b) => (b.credibility ?? -1) - (a.credibility ?? -1));
    const cols = Math.min(3, ps.length);
    const w = cols * PAPER_W + (cols - 1) * GAP;
    const left = Math.max(cx - w / 2, cursor + 40);
    cursor = left + w;
    grid(ps.map((p) => p.id), left + w / 2, y0, cols, PAPER_W, PAPER_H).forEach((pos) =>
      nodes.push({ id: `p:${pos.id}`, kind: "paper", x: pos.x, y: pos.y, w: PAPER_W, h: PAPER_H, data: { id: pos.id, side: null, shared: ks.length > 1 } }),
    );
    for (const p of ps) {
      for (const k of ks) {
        const st = dominant(p, Object.values(s.findings).filter((f) => f.paper_id === p.id), k);
        edges.push({ id: `hp:${k}:${p.id}`, source: `h:${k}`, target: `p:${p.id}`, kind: st ? "evidence" : "considered", stance: st ?? undefined, weight: 0.3 });
      }
    }
  }
  const placed = new Set(nodes.map((n) => n.id));
  for (const [a, b] of s.cites) if (placed.has(`p:${a}`) && placed.has(`p:${b}`)) edges.push({ id: `ci:${a}:${b}`, source: `p:${a}`, target: `p:${b}`, kind: "cites" });
  return { nodes, edges, bounds: bounds(nodes) };
}
