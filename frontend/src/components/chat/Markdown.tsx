"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Fragment, memo } from "react";
import type { Trail } from "@/lib/chat";
import type { State } from "@/lib/store";
import { StanceGlyph } from "../graph/glyphs";

/*
 * The small subset of Markdown the assistant is asked to write (paragraphs, "-" and "1." lists,
 * **bold**, *italic*, `code`, fenced code), plus citations: [[P3]] / [[F12]] / [[H1]] refs from the
 * context digest, or [[paper:ID]] / [[finding:ID]] / [[hypothesis:KEY]] for ids seen in query results.
 * A fenced block shaped like a walk through the graph (nodes, with "-[REL]->" steps between them)
 * is drawn as a chain.
 */

export interface CiteHandlers {
  state: State;
  aliases?: Record<string, string>;
  hk: string | null;
  onPeek: (nodeId: string) => void;
  onFocus: (key: string) => void;
  onRefs: (ids: string[] | null) => void;
  onTrail?: (t: Trail | null) => void;
  hidePaths?: boolean; // the reply shows its routes elsewhere, so path blocks in its text are skipped
}

type Target = { kind: "paper" | "finding" | "hypothesis"; id: string };

function resolve(raw: string, aliases: Record<string, string> = {}): Target | null {
  const s = raw.trim();
  const m = /^(paper|finding|hypothesis):(.+)$/.exec(s);
  if (m) return { kind: m[1] as Target["kind"], id: m[2].trim() };
  const id = aliases[s];
  if (!id) return null;
  return { kind: s[0] === "P" ? "paper" : s[0] === "F" ? "finding" : "hypothesis", id };
}

export function Cite({ raw, h }: { raw: string; h: CiteHandlers }) {
  const t = resolve(raw, h.aliases);
  const { state } = h;
  const base =
    "mx-0.5 inline-flex max-w-[16rem] translate-y-[-1px] items-center gap-1 rounded-md border bg-card px-1.5 py-px align-middle text-[12.5px] font-medium leading-[1.5] text-ink-2 transition-colors hover:border-ring hover:bg-accent hover:text-ink";
  if (t?.kind === "paper" && state.papers[t.id]) {
    const p = state.papers[t.id];
    return (
      <button type="button" className={base} title={p.title} onClick={() => h.onPeek(`p:${t.id}`)}>
        <span className="truncate">{p.label}</span>
      </button>
    );
  }
  if (t?.kind === "finding" && state.findings[t.id]) {
    const f = state.findings[t.id];
    const e = h.hk ? f.evidence[h.hk] : Object.values(f.evidence)[0];
    return (
      <button
        type="button"
        className={base}
        title={`${f.text}, ${state.papers[f.paper_id]?.label ?? ""}`}
        onClick={() => h.onPeek(`f:${t.id}`)}
        onMouseEnter={() => h.onRefs([t.id])}
        onMouseLeave={() => h.onRefs(null)}
        onFocus={() => h.onRefs([t.id])}
        onBlur={() => h.onRefs(null)}
      >
        {e && <StanceGlyph stance={e.stance} size={11} />}
        <span className="truncate">{f.text}</span>
      </button>
    );
  }
  if (t?.kind === "hypothesis" && state.hyps[t.id]) {
    const n = state.hypOrder.indexOf(t.id) + 1;
    return (
      <button type="button" className={base} title={state.hyps[t.id].statement} onClick={() => h.onFocus(t.id)}>
        <span className="text-[12px] text-ink-3">H{n}</span>
        <span className="truncate">{state.hyps[t.id].statement}</span>
      </button>
    );
  }
  // A ref the model made up or that isn't loaded: show it as text rather than a dead link.
  return <span className="text-[12px] text-ink-3">{raw}</span>;
}

const INLINE = /(\[\[[^\]\n]{1,200}\]\]|\*\*[^*\n]+\*\*|`[^`\n]+`|(?<![\w*])\*[^*\s][^*\n]*\*(?!\w)|(?<![\w_])_[^_\s][^_\n]*_(?!\w))/g;

function Inline({ text, h }: { text: string; h: CiteHandlers }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = m.index!;
    if (tok.startsWith("[[")) out.push(<Cite key={k} raw={tok.slice(2, -2)} h={h} />);
    else if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold text-ink"><Inline text={tok.slice(2, -2)} h={h} /></strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="code rounded bg-muted px-1 py-px text-[12.5px]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}><Inline text={tok.slice(1, -1)} h={h} /></em>);
    last = k + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] } | { kind: "code"; lines: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let fence: Block | null = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^\s*```/.test(line)) {
      fence = fence ? null : { kind: "code", lines: [] };
      if (fence) out.push(fence);
      continue;
    }
    if (fence?.kind === "code") {
      fence.lines.push(line);
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const prev = out[out.length - 1];
    if (bullet || num) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? num)![1];
      if (prev?.kind === kind) prev.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (!line.trim()) {
      if (prev && !(prev.kind === "p" && prev.lines.length === 0)) out.push({ kind: "p", lines: [] });
    } else if (prev?.kind === "p") prev.lines.push(line.replace(/^#+\s*/, ""));
    else if ((prev?.kind === "ul" || prev?.kind === "ol") && /^\s{2,}/.test(line)) prev.items[prev.items.length - 1] += " " + line.trim(); // a wrapped list item
    else out.push({ kind: "p", lines: [line.replace(/^#+\s*/, "")] });
  }
  return out.filter((b) => ("items" in b ? b.items.length > 0 : b.lines.length > 0));
}

type Step = { kind: "node"; text: string } | { kind: "rel"; rel: string; back: boolean };

// "-[DESCRIBES]->", "<-[:CITES]-", "-[EVIDENCE_FOR {stance}]->", optionally followed by the next node.
const REL = /^\s*(<)?-\[:?\s*([A-Za-z_|]+)[^\]]*\]-(>)?\s*(.*)$/;

/** A block's lines as a walk through the graph, or null when it isn't one. */
function walk(lines: string[]): Step[] | null {
  const steps: Step[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = REL.exec(line);
    if (m) {
      steps.push({ kind: "rel", rel: m[2].toUpperCase(), back: !!m[1] && !m[3] });
      if (m[4]) steps.push({ kind: "node", text: m[4] });
    } else steps.push({ kind: "node", text: line });
  }
  const rels = steps.filter((s) => s.kind === "rel").length;
  return rels > 0 && steps[0]?.kind === "node" && steps.length > rels ? steps : null;
}

const KINDS = ["paper", "study", "finding", "hypothesis", "question", "concept", "author", "lab", "funder", "cluster"];

/** "paper Heyward 2020" -> a citation of that paper when it is loaded, else its kind and text. */
function PathNode({ text, h }: { text: string; h: CiteHandlers }) {
  const m = new RegExp(`^\\(?(${KINDS.join("|")})\\b[:\\s]*`, "i").exec(text);
  const kind = m?.[1].toLowerCase() ?? null;
  // "(paper Heyward 2020)" is Cypher-style; drop that wrapping bracket, not one that belongs to the text.
  const body = m ? text.slice(m[0].length) : text;
  const rest = (m?.[0].startsWith("(") ? body.replace(/\)$/, "") : body).replace(/^["“]|["”.]+$/g, "").trim();
  const { state } = h;
  let ref: string | null = null;
  if (!/\[\[/.test(rest)) {
    const low = rest.toLowerCase();
    // A raw id, maybe followed by a gloss: "doi:10.1111/dom.14091 (Arnott 2020)".
    const id = rest.split(/\s+\(/)[0].trim();
    if (kind === "paper" && state.papers[id]) ref = id;
    if (kind === "finding" && state.findings[id]) ref = id;
    if (kind === "hypothesis" && state.hyps[id]) ref = id;
    if (kind === "paper" && !ref) ref = Object.values(state.papers).find((p) => p.label.toLowerCase() === low)?.id ?? null;
    if (kind === "hypothesis" && !ref) {
      const k = state.hypOrder.find((x) => state.hyps[x].statement.toLowerCase().replace(/\.$/, "") === low);
      if (k) ref = k;
    }
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="size-[7px] shrink-0 rounded-full border-[1.5px] border-ink-3 bg-card" />
      {kind && <span className="w-[4.5rem] shrink-0 text-[12px] text-ink-3 first-letter:uppercase">{kind}</span>}
      <span className="min-w-0 text-ink">
        {ref ? <Cite raw={`${kind}:${ref}`} h={h} /> : <Inline text={rest} h={h} />}
      </span>
    </span>
  );
}

function Path({ steps, h }: { steps: Step[]; h: CiteHandlers }) {
  return (
    <ol className="rounded-lg border bg-card px-3 py-2.5" aria-label="Path through the graph">
      {steps.map((s, i) =>
        s.kind === "node" ? (
          <li key={i}>
            <PathNode text={s.text} h={h} />
          </li>
        ) : (
          <li key={i} className="ml-[3px] flex items-center gap-1.5 border-l border-line-2 py-1.5 pl-[13px] text-[12px] text-ink-3">
            {s.back ? <ArrowUp className="size-3" aria-label="from" /> : <ArrowDown className="size-3" aria-label="to" />}
            <span className="code">{s.rel}</span>
          </li>
        ),
      )}
    </ol>
  );
}

export const Markdown = memo(function Markdown({ text, h }: { text: string; h: CiteHandlers }) {
  return (
    <div className="space-y-2 text-[13px] leading-[1.6] text-ink-2">
      {blocks(text).map((b, i) =>
        b.kind === "code" ? (
          (() => {
            const steps = walk(b.lines);
            if (steps && h.hidePaths) return null;
            return steps ? (
              <Path key={i} steps={steps} h={h} />
            ) : (
              <pre key={i} className="code scroll-thin overflow-x-auto whitespace-pre rounded-md bg-muted/60 p-2 text-[12px] leading-relaxed text-ink-2">
                {b.lines.join("\n")}
              </pre>
            );
          })()
        ) : b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l} h={h} />
              </Fragment>
            ))}
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="ml-4 list-disc space-y-1 marker:text-ink-3">
            {b.items.map((it, j) => (
              <li key={j} className="pl-0.5">
                <Inline text={it} h={h} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="ml-4 list-decimal space-y-1 marker:text-ink-3">
            {b.items.map((it, j) => (
              <li key={j} className="pl-0.5">
                <Inline text={it} h={h} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
});
