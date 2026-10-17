import { useCallback, useSyncExternalStore } from "react";

const KEY = "tg-legend";
const EVENT = "tg-legend-change";
let memory: boolean | null = null; // used when storage is unavailable

function read() {
  try {
    return localStorage.getItem(KEY) !== "hidden";
  } catch {
    return memory ?? true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Whether the graph legend is expanded; remembered across reloads. */
export function useLegend() {
  const open = useSyncExternalStore(subscribe, read, () => true);
  const setOpen = useCallback((o: boolean) => {
    memory = o;
    try {
      localStorage.setItem(KEY, o ? "shown" : "hidden");
    } catch {
      // Storage blocked: `memory` keeps the choice for this visit.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [open, setOpen] as const;
}
