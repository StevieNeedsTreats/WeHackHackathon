"use client";

import { createContext, useContext } from "react";
import type { State } from "@/lib/store";

export interface GraphCtx {
  state: State;
  focus: string | null; // hypothesis key, or null in All mode
  active: Set<string> | null; // highlighted ids (nodes + edges); null = nothing focused
  selected: string | null;
  fresh: Set<string>; // ids that should play their entry animation
  hNum: Record<string, number>; // hypothesis key → 1-based number
}

export const GraphContext = createContext<GraphCtx | null>(null);
export const useGraph = () => useContext(GraphContext)!;

export function dimClass(ctx: GraphCtx, id: string) {
  return ctx.active && !ctx.active.has(id) ? "tg-dim" : "";
}
