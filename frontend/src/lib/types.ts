export type Stance = "supports" | "refutes" | "mixed";
export type Direction = "increase" | "decrease" | "no_change" | "mixed";
export type Tone = "support" | "refute" | "mixed" | "neutral";

export interface Concept {
  id: string;
  name: string;
  synonyms?: string[];
}

export interface Hypothesis {
  key: string;
  statement: string;
  domain: string;
  relation: string;
  subject: Concept;
  outcome: Concept;
  population: Concept | null;
  assumed?: string[];
  search_terms?: string[];
  // live run state
  reused?: boolean;
  papers?: number;
  verdict?: string | null;
  stage?: "discovery" | "stance" | "contradictions" | "verdict" | "done";
  // stored
  grade?: string;
  share_support?: number;
  share_refute?: number;
  share_mixed?: number;
}

export interface Question {
  id: string;
  text: string;
  domain: string;
  hypotheses: Hypothesis[];
  corrections?: string[];
  compare?: boolean;
}

export interface DomainInfo {
  id: string;
  name: string;
  subject: string;
  outcome: string;
  population: string;
}

export interface Person {
  id: string;
  name: string;
  pos?: number;
}
export interface Funder {
  id: string;
  name: string;
  type: "industry" | "public" | "academic" | "other" | string;
}
export interface Lab {
  id: string;
  name: string;
  country?: string | null;
}

export interface CredReason {
  id: string;
  label: string;
  points: number;
  detail: string;
  judged?: boolean;
}

export interface Paper {
  id: string;
  title: string;
  label: string;
  year?: number;
  journal?: string;
  design?: string;
  citations?: number;
  peer_reviewed?: boolean;
  url?: string;
  kind?: string;
  doi?: string;
  pmid?: string;
  demo?: boolean;
  retracted?: boolean;
  n?: number | null;
  authors: Person[];
  funders: Funder[];
  labs: Lab[];
  considered: Record<string, { relevance: number; slice: string }>;
  credibility?: number | null;
  reasons?: CredReason[];
  flags?: string[];
}

export interface Study {
  id: string;
  paper_id: string;
  design: string;
  n?: number;
  pooled_studies?: number;
  population?: string;
  setting?: string;
  exposure?: string;
  comparator?: string;
  duration?: string;
}

export interface Evidence {
  stance: Stance;
  weight: number;
  rationale: string;
  cluster: string | null;
}

export interface Finding {
  id: string;
  paper_id: string;
  study_id: string;
  outcome: { id: string; name: string };
  direction: Direction;
  text: string;
  effect_value?: number;
  effect_text?: string;
  effect_unit?: string;
  harm?: boolean;
  quote?: string;
  quote_verified?: boolean;
  flags?: string[];
  evidence: Record<string, Evidence>;
}

export interface Cluster {
  id: string;
  label: string;
  context: string;
  hypothesis: string;
  findings: string[];
}

export interface Contradiction {
  hypothesis: string;
  a: string;
  b: string;
  reason: string;
  severity: "high" | "medium" | "low";
  explained_by: string | null;
}

export interface Insight {
  kind: "headline" | "finding" | "safety" | "conflict" | "funding" | "gap" | "quality";
  title: string;
  body: string;
  tone: Tone;
  refs: string[];
}

export interface Verdict {
  hypothesis: string;
  verdict: "Supported" | "Refuted" | "Contested" | "Insufficient evidence" | string;
  tone: Tone;
  grade: "A" | "B" | "C" | "D";
  papers: number;
  findings: number;
  weight: number;
  support: number;
  refute: number;
  mixed: number;
  best_design: string | null;
  clusters: Record<string, { supports: number; refutes: number; mixed: number; n: number }>;
  contradictions: { a: string; b: string; reason: string; explained_by: string | null }[];
  funding: Record<string, Record<Stance, number>>;
  papers_searched: number;
  search_note: string;
  summary: string;
  gaps: string[];
  insights: Insight[];
}

export interface Metric {
  id: string;
  title: string;
  question: string;
  hops: number | string;
  cypher: string;
  rows: number;
  columns: string[];
  sample: unknown[][];
  median_ms: number;
  p95_ms: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  calls: number;
}

export interface Stats {
  papers: number;
  findings: number;
  contradictions: number;
  flags: number;
  elapsed_ms: number;
  http_requests: number;
  cache_hits: number;
  graph_nodes: number;
  graph_edges: number;
  engine: string;
  mode: string;
  usage?: { total: Usage; agents: Record<string, Usage> };
}

export interface Flag {
  target: string;
  code: string;
  detail: string;
}

export interface GuardCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Guardrail {
  ok: boolean;
  code?: string;
  message?: string;
  checks?: GuardCheck[];
}

export interface Interpretation {
  ok: boolean;
  code?: string;
  message?: string;
  checks?: GuardCheck[];
  question?: Question;
  notice?: string | null;
  disclaimer?: string;
  domain?: DomainInfo;
}

export interface Health {
  falkordb: boolean;
  graph: string;
  nodes: number;
  edges: number;
  llm: { available: boolean; provider: string; models: Record<string, string> };
  disclaimer: string;
  domains: { id: string; name: string; examples: string[] }[];
  demos: { id: string; text: string; domain: string | null }[];
}

export interface QuestionSummary {
  id: string;
  text: string;
  domain: string;
  created?: number;
  hypotheses: { key: string; statement: string; verdict?: string | null; grade?: string | null }[];
}
