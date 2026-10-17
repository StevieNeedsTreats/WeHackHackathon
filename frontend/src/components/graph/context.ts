"use client";

import { createContext, useContext } from "react";
import type { Consensus } from "@/lib/types";

export interface GraphCtx {
  active: Set<string> | null; // highlighted ids (nodes + edges); null = nothing focused
  selected: string | null;
  consensus: Record<string, Consensus>; // keyed by outcome node id
  fresh: Set<string>; // ids that should play their entry animation
}

export const GraphContext = createContext<GraphCtx>({ active: null, selected: null, consensus: {}, fresh: new Set() });
export const useGraph = () => useContext(GraphContext);

export function dimClass(ctx: GraphCtx, id: string) {
  return ctx.active && !ctx.active.has(id) ? "tg-dim" : "";
}
