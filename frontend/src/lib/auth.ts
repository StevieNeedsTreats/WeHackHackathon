import { useSyncExternalStore } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8100";

/*
 * Sessions: the server issues a short-lived access token and a long-lived refresh token.
 * The access token stays in memory and goes out as `Authorization: Bearer …`. The refresh token
 * is kept in localStorage so a reload or a new tab signs in silently; it is traded for a new pair
 * when the access token runs out (or a request comes back 401), which also rotates it.
 */

const KEY = "tg-refresh";
const EVENT = "tg-session-change";
const SKEW_MS = 30_000; // refresh a little before expiry to allow for clock drift

type Token = { token: string; expires: number }; // expires: unix seconds
type Pair = { access: string; access_expires: number; refresh: string; refresh_expires: number };

let access: Token | null = null;
let memoryRefresh: string | null = null; // used when storage is unavailable
let refreshing: Promise<boolean> | null = null;

const live = (t: Token | null) => !!t && t.expires * 1000 - SKEW_MS > Date.now();

function readRefresh(): Token | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = memoryRefresh;
  }
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Token;
    return live(t) ? t : null;
  } catch {
    return null;
  }
}

function writeRefresh(t: Token | null) {
  const raw = t ? JSON.stringify(t) : null;
  memoryRefresh = raw;
  try {
    if (raw) localStorage.setItem(KEY, raw);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: `memoryRefresh` keeps the session for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

function store(p: Pair) {
  access = { token: p.access, expires: p.access_expires };
  writeRefresh({ token: p.refresh, expires: p.refresh_expires });
}

export function signOut() {
  access = null;
  writeRefresh(null);
}

/** Trade the refresh token for a new pair. Concurrent callers share one request. */
function refresh(): Promise<boolean> {
  const r = readRefresh();
  if (!r) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API}/api/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh: r.token }),
      });
      if (res.status === 401) {
        signOut();
        return false;
      }
      if (!res.ok) return false; // server trouble: keep the session and try again later
      store(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function bearer(): Promise<Record<string, string>> {
  if (!live(access) && readRefresh()) await refresh();
  return live(access) ? { authorization: `Bearer ${access!.token}` } : {};
}

/**
 * fetch with the session attached. A 401 triggers one refresh and one retry; if that still
 * fails the session is dropped and the sign-in screen comes back.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async () => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...(await bearer()) } });
  let res = await send();
  if (res.status === 401 && readRefresh()) {
    access = null;
    if (await refresh()) res = await send();
  }
  if (res.status === 401) signOut();
  return res;
}

// ---- React: signed in = holds a usable refresh token (shared across tabs)

const hasSession = () => readRefresh() !== null;

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // sign-in / sign-out in other tabs
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Whether this browser holds a session. False during server render. */
export function useSignedIn() {
  return useSyncExternalStore(subscribe, hasSession, () => false);
}

/** Whether the server asks for a password at all. */
export async function authRequired(): Promise<boolean> {
  const r = await fetch(`${API}/api/auth`);
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()).required;
}

export async function signIn(password: string): Promise<void> {
  const r = await fetch(`${API}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  if (!r.ok) {
    let msg = r.status === 401 ? "Wrong password" : `Sign-in failed (${r.status})`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {}
    throw new Error(msg);
  }
  store(await r.json());
}
