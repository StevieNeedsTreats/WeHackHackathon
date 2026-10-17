"use client";

import { toast, type ExternalToast } from "sonner";

/*
 * Toasts for work that finishes in the background (research runs, papers being added). When the
 * tab is hidden, a dot on its title says something finished, until the reader comes back.
 */

const MARK = "● ";
let watching = false;

function markTitle() {
  if (typeof document === "undefined" || !document.hidden) return;
  if (!document.title.startsWith(MARK)) document.title = MARK + document.title;
  if (watching) return;
  watching = true;
  document.addEventListener("visibilitychange", function clear() {
    if (document.hidden) return;
    if (document.title.startsWith(MARK)) document.title = document.title.slice(MARK.length);
    document.removeEventListener("visibilitychange", clear);
    watching = false;
  });
}

export function notify(kind: "success" | "error" | "info", title: string, opts?: ExternalToast) {
  toast[kind](title, opts);
  if (kind !== "info") markTitle();
}
