// ============================================================================
// SAY AH — LOCAL STORAGE
// Persistence for personal best and session history. Browser-only — all calls
// must be inside an effect or event handler, never during render (Next.js
// will hydrate-mismatch otherwise).
// ============================================================================

import { PB_KEY, STORAGE_KEY } from "./constants";
import type { SessionRecord } from "./types";

const MAX_HISTORY = 30;

export function loadPersonalBest(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(PB_KEY);
  return raw ? parseFloat(raw) : 0;
}

export function savePersonalBest(value: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PB_KEY, value.toString());
}

export function loadHistory(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSession(durations: number[]): void {
  if (typeof window === "undefined") return;
  if (!durations || durations.length === 0) return;
  const sessions = loadHistory();
  sessions.push({
    date: new Date().toISOString(),
    durations,
    average: durations.reduce((a, b) => a + b, 0) / durations.length,
    best: Math.max(...durations),
  });
  // Keep only the most recent MAX_HISTORY sessions
  while (sessions.length > MAX_HISTORY) sessions.shift();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}
