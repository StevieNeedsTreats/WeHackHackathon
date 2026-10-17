import { useSyncExternalStore } from "react";

const KEY = "tg-tooltips";
const EVENT = "tg-tooltips-change";

function read() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(EVENT, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Whether hover tooltips are on. Server render and hydration assume on, then the saved choice applies. */
export function useTooltips() {
  return useSyncExternalStore(subscribe, read, () => true);
}

export function setTooltips(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: nothing to persist, but the event below still updates this page.
  }
  window.dispatchEvent(new Event(EVENT));
}
