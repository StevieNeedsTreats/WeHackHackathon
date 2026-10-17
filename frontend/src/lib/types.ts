export type Kind = "substance" | "paper" | "author" | "lab" | "funder" | "claim" | "outcome";
export type Direction = "positive" | "neutral" | "null";
export type EdgeType =
  | "STUDIED_IN"
  | "AUTHORED_BY"
  | "FROM_LAB"
  | "FUNDED_BY"
  | "REPORTS"
  | "ABOUT"
  | "CITES"
  | "CONTRADICTS"
  | "SUPPORTS";

export interface CredReason {
  label: string;
  points: number;
  detail: string;
}

export interface GNode {
  id: string;
  kind: Kind;
  name?: string;
  key?: string;
  // paper
  paper_id?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  label?: string;
  year?: number;
  journal?: string;
  design?: string;
  sample_size?: number | null;
  studies?: number | null;
  citations?: number;
  peer_reviewed?: boolean;
  url?: string;
  abstract?: string;
  lab?: string;
  region?: string;
  demo?: boolean;
  funding?: string[];
  first_authors?: string[];
  credibility?: number;
  cred_reasons?: CredReason[];
  flags?: string[];
  // funder / lab
  type?: string;
  // claim
  claim_id?: string;
  text?: string;
  direction?: Direction;
  harm?: boolean;
  effect?: string | null;
  quote?: string;
  quote_verified?: boolean;
  outcome?: string;
  category?: string;
  extractor?: string;
  // outcome
  counts?: Record<Direction, number>;
  papers?: number;
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  reason?: string;
  severity?: string;
  position?: number;
}

export type AgentStatus = "queued" | "running" | "done" | "error";

export interface AgentState {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  detail: string;
  done?: number | null;
  total?: number | null;
  ms: number;
}

export interface Consensus {
  outcome_key: string;
  outcome: string;
  category: string;
  papers: number;
  claims: number;
  share: Record<Direction, number>;
  weight: number;
  verdict: string;
  tone: Direction;
  grade: "A" | "B" | "C" | "D";
  claim_ids: string[];
}

export interface InsightItem {
  kind: "headline" | "finding" | "safety" | "conflict" | "funding" | "gap" | "quality";
  title: string;
  body: string;
  tone: Direction;
  refs: string[];
}

export interface Insights {
  consensus: Consensus[];
  items: InsightItem[];
  narrative?: string;
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

export interface Stats {
  papers: number;
  claims: number;
  directions: Record<Direction, number>;
  contradictions: number;
  flags: number;
  elapsed_ms: number;
  http_requests: number;
  cache_hits: number;
  graph_nodes: number;
  graph_edges: number;
  engine: string;
  mode: string;
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
  value?: string;
  checks?: GuardCheck[];
}

export interface Health {
  falkordb: boolean;
  graph: string;
  nodes: number;
  edges: number;
  extractor: string;
  model: string | null;
  disclaimer: string;
}

export interface SubstanceSummary {
  key: string;
  name: string;
  papers: number;
  claims: number;
  updated: number;
}
