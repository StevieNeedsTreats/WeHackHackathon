import type { Direction, GEdge, GNode } from "./types";

/**
 * Structural layout. Every entity type owns a row and every paper owns a column,
 * so papers align with papers, funders align with funders, and claims sit in the
 * column of the paper that reports them, inside a band for their direction.
 */
export const COL_W = 224;
export const PAPER_W = 188;
export const PAPER_H = 96;
export const CLAIM_W = 188;
export const CLAIM_H = 62;
export const PILL_H = 26;
export const SPINE_X = PAPER_W - 20; // x-offset of the paper → claim "spine"
export const GUTTER = 150; // left gutter for row labels

export const BANDS: { dir: Direction; label: string; hint: string }[] = [
  { dir: "positive", label: "Positive", hint: "benefit, or no harm" },
  { dir: "neutral", label: "Mixed", hint: "uncertain or conditional" },
  { dir: "null", label: "Negative / null", hint: "no effect, or harm" },
];

export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Row {
  id: string;
  label: string;
  hint?: string;
  y: number;
  h: number;
  dir?: Direction;
}

export interface Layout {
  pos: Record<string, Placed>;
  rows: Row[];
  width: number;
  height: number;
}

const pillWidth = (text: string, extra = 40) => Math.min(PAPER_W - 34, Math.max(72, text.length * 6.4 + extra));

/** Push items right so none overlap, keeping each as close to its ideal x as possible. */
function resolveRow(items: { id: string; x: number; w: number }[], gap = 12) {
  items.sort((a, b) => a.x - b.x);
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const min = prev.x + prev.w + gap;
    if (items[i].x < min) items[i].x = min;
  }
  return items;
}

export function computeLayout(nodes: Record<string, GNode>, edges: Record<string, GEdge>, order: string[]): Layout {
  const pos: Record<string, Placed> = {};
  const rows: Row[] = [];
  const list = Object.values(nodes);
  const arrival = new Map(order.map((id, i) => [id, i]));

  const papers = list
    .filter((n) => n.kind === "paper")
    .sort((a, b) => {
      const ca = a.credibility ?? -1;
      const cb = b.credibility ?? -1;
      if (ca !== cb) return cb - ca;
      return (arrival.get(a.id) ?? 0) - (arrival.get(b.id) ?? 0);
    });
  const col = new Map(papers.map((p, i) => [p.id, i * COL_W]));
  const cols = Math.max(papers.length, 1);
  const width = (cols - 1) * COL_W + PAPER_W;

  const bySource: Record<string, GEdge[]> = {};
  for (const e of Object.values(edges)) (bySource[e.source] ??= []).push(e);

  // Row 0 — substance
  const sub = list.find((n) => n.kind === "substance");
  let y = 0;
  if (sub) {
    const w = 240;
    pos[sub.id] = { x: width / 2 - w / 2, y, w, h: 64 };
  }
  y += 64 + 84;

  // Row 1 — papers
  rows.push({ id: "row-papers", label: "Papers", hint: "sorted by credibility", y: y - 12, h: PAPER_H + 24 });
  for (const p of papers) pos[p.id] = { x: col.get(p.id)!, y, w: PAPER_W, h: PAPER_H };
  y += PAPER_H + 36;

  // Rows 2–3 — first author, then lab · region, directly under their paper
  const authorY = y;
  const labY = y + PILL_H + 10;
  rows.push({ id: "row-authors", label: "Authors", y: authorY - 6, h: PILL_H + 12 });
  rows.push({ id: "row-labs", label: "Lab · region", y: labY - 6, h: PILL_H + 12 });
  for (const p of papers) {
    for (const e of bySource[p.id] ?? []) {
      const t = nodes[e.target];
      if (!t || pos[t.id]) continue;
      if (e.type === "AUTHORED_BY") pos[t.id] = { x: col.get(p.id)!, y: authorY, w: pillWidth(t.name ?? ""), h: PILL_H };
      if (e.type === "FROM_LAB") pos[t.id] = { x: col.get(p.id)!, y: labY, w: pillWidth((t.name ?? "") + (t.region ?? ""), 52), h: PILL_H };
    }
  }
  y = labY + PILL_H + 30;

  // Row 4 — funders, centred under the papers they fund (shared funders sit between them)
  const funderY = y;
  const funders = list.filter((n) => n.kind === "funder");
  if (funders.length) {
    rows.push({ id: "row-funders", label: "Funders", y: funderY - 8, h: PILL_H + 16 });
    const xs: Record<string, number[]> = {};
    for (const e of Object.values(edges)) if (e.type === "FUNDED_BY" && col.has(e.source)) (xs[e.target] ??= []).push(col.get(e.source)!);
    const items = funders
      .filter((f) => xs[f.id])
      .map((f) => {
        const w = pillWidth(f.name ?? "", 64);
        const avg = xs[f.id].reduce((a, b) => a + b, 0) / xs[f.id].length;
        return { id: f.id, x: avg + 12, w };
      });
    for (const it of resolveRow(items)) pos[it.id] = { x: it.x, y: funderY, w: it.w, h: PILL_H };
    y += PILL_H + 48;
  } else {
    y += 12;
  }

  // Rows 5–7 — claim bands. Within a band, a paper's claims stack in its column.
  const claims = list.filter((n) => n.kind === "claim" && n.paper_id && col.has(`p:${n.paper_id}`));
  for (const band of BANDS) {
    const inBand = claims.filter((c) => (c.direction ?? "neutral") === band.dir);
    const stacks: Record<string, GNode[]> = {};
    for (const c of inBand) (stacks[c.paper_id!] ??= []).push(c);
    const depth = Math.max(1, ...Object.values(stacks).map((s) => s.length));
    const h = 40 + depth * (CLAIM_H + 10) + 6;
    rows.push({ id: `band-${band.dir}`, label: band.label, hint: band.hint, y, h, dir: band.dir });
    for (const [pid, stack] of Object.entries(stacks)) {
      stack.sort((a, b) => (a.outcome ?? "").localeCompare(b.outcome ?? ""));
      stack.forEach((c, i) => {
        pos[c.id] = { x: col.get(`p:${pid}`)!, y: y + 34 + i * (CLAIM_H + 10), w: CLAIM_W, h: CLAIM_H };
      });
    }
    y += h + 14;
  }

  // Row 8 — outcomes, under the centre of mass of their claims
  y += 40;
  const outcomes = list.filter((n) => n.kind === "outcome");
  if (outcomes.length) {
    const xs: Record<string, number[]> = {};
    for (const e of Object.values(edges)) {
      if (e.type !== "ABOUT" || !pos[e.source]) continue;
      (xs[e.target] ??= []).push(pos[e.source].x + CLAIM_W / 2);
    }
    const items = outcomes
      .filter((o) => xs[o.id])
      .map((o) => {
        const w = Math.max(150, Math.min(210, (o.name?.length ?? 10) * 7.4 + 70));
        const avg = xs[o.id].reduce((a, b) => a + b, 0) / xs[o.id].length;
        return { id: o.id, x: avg - w / 2, w };
      });
    // Two staggered lines when a single line would drift far from the claims.
    const placed = resolveRow(items, 14);
    const overflow = placed.length && placed[placed.length - 1].x + placed[placed.length - 1].w > width + 160;
    if (overflow) {
      const a = resolveRow(items.filter((_, i) => i % 2 === 0).map((it) => ({ ...it, x: (xs[it.id].reduce((p, c) => p + c, 0) / xs[it.id].length) - it.w / 2 })), 14);
      const b = resolveRow(items.filter((_, i) => i % 2 === 1).map((it) => ({ ...it, x: (xs[it.id].reduce((p, c) => p + c, 0) / xs[it.id].length) - it.w / 2 })), 14);
      for (const it of a) pos[it.id] = { x: it.x, y, w: it.w, h: 58 };
      for (const it of b) pos[it.id] = { x: it.x, y: y + 78, w: it.w, h: 58 };
      rows.push({ id: "row-outcomes", label: "Outcomes", hint: "claims grouped", y: y - 14, h: 58 + 78 + 28 });
      y += 78;
    } else {
      for (const it of placed) pos[it.id] = { x: it.x, y, w: it.w, h: 58 };
      rows.push({ id: "row-outcomes", label: "Outcomes", hint: "claims grouped", y: y - 14, h: 58 + 28 });
    }
    y += 58;
  }

  return { pos, rows, width, height: y };
}
