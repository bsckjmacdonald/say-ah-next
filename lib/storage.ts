// ============================================================================
// SAY AH — LOCAL STORAGE
// Persistence for personal best and session history. Browser-only — all calls
// must be inside an effect or event handler, never during render (Next.js
// will hydrate-mismatch otherwise).
// ============================================================================

import {
  COACH_STORAGE_KEY,
  DEVICE_OFFSET_KEY_PREFIX,
  PB_KEY,
  SPEAK_COACH_CUES_KEY,
  STORAGE_KEY,
} from "./constants";
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

// Coach-cue TTS preference. Default is false — clinician feedback was that
// the in-rep voice was distracting. The on-screen cue always shows; this
// only controls whether it's also spoken.
export function loadSpeakCoachCues(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SPEAK_COACH_CUES_KEY) === "true";
}

export function saveSpeakCoachCues(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SPEAK_COACH_CUES_KEY, value ? "true" : "false");
}

export function loadHistory(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function loadCoachEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(COACH_STORAGE_KEY);
  return raw === null ? true : raw === "true";
}

export function saveCoachEnabled(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COACH_STORAGE_KEY, String(value));
}

/** Returns the calibrated offset for this deviceId, or `fallback` if uncalibrated. */
export function loadDeviceOffset(deviceId: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(DEVICE_OFFSET_KEY_PREFIX + deviceId);
  return raw ? parseFloat(raw) : fallback;
}

export function saveDeviceOffset(deviceId: string, offset: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEVICE_OFFSET_KEY_PREFIX + deviceId, String(offset));
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
