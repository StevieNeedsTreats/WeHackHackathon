"use client";

import { createContext, useContext } from "react";
import type { State } from "@/lib/store";

/**
 * Slow-changing graph data shared by every node and edge. Hover, selection and dimming are
 * deliberately not here: they are applied with a generated stylesheet (see GraphCanvas), so
 * hovering never re-renders the nodes.
 */
export interface GraphCtx {
  state: State;
  focus: string | null; // hypothesis key, or null in All mode
  hNum: Record<string, number>; // hypothesis key → 1-based number
}

export const GraphContext = createContext<GraphCtx | null>(null);
export const useGraph = () => useContext(GraphContext)!;

/** Contradiction edges whose reason label is shown; only contradiction labels subscribe to it. */
export const LabelContext = createContext<Set<string>>(new Set());
