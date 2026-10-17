// Shared by the server page (reads the cookie) and the client shell (writes it); no React imports.

export const LAYOUT_COOKIE = "tg-layout";

const IDS = ["left", "main", "right"] as const;

/** The saved panel layout (percentages by panel id), or undefined if missing or malformed. */
export function parseLayout(raw: string | undefined): Record<string, number> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    if (!IDS.every((k) => typeof v?.[k] === "number" && v[k] >= 0 && v[k] <= 100)) return undefined;
    return Object.fromEntries(IDS.map((k) => [k, v[k]]));
  } catch {
    return undefined;
  }
}
