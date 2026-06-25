// ============================================================================
// SAY AH — LOCAL STORAGE
// Persistence for personal best and session history. Browser-only — all calls
// must be inside an effect or event handler, never during render (Next.js
// will hydrate-mismatch otherwise).
// ============================================================================

import {
  COACH_STORAGE_KEY,
  COACH_VOICE_KEY,
  COACHING_LEVEL_KEY,
  DEVICE_BASELINE_KEY_PREFIX,
  DEVICE_OFFSET_KEY_PREFIX,
  PB_KEY,
  SETUP_COMPLETE_KEY,
  SPEAK_COACH_CUES_KEY,
  STORAGE_KEY,
} from "./constants";
import { DEFAULT_COACH_VOICE, type CoachVoiceId } from "./coachVoice";
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

/** Clinician-selected Kokoro coach voice; default when /setup hasn't run. */
export function loadCoachVoice(): CoachVoiceId {
  if (typeof window === "undefined") return DEFAULT_COACH_VOICE;
  return (
    (window.localStorage.getItem(COACH_VOICE_KEY) as CoachVoiceId | null) ??
    DEFAULT_COACH_VOICE
  );
}

export function saveCoachVoice(voice: CoachVoiceId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COACH_VOICE_KEY, voice);
}

// In-rep coaching verbosity, set by the clinician at /setup.
//   minimal      — visual cue only, no voice during the rep
//   standard     — voice cue (default)
//   encouraging  — voice cue, more frequent
export type CoachingLevel = "minimal" | "standard" | "encouraging";

export function loadCoachingLevel(): CoachingLevel {
  if (typeof window === "undefined") return "standard";
  const raw = window.localStorage.getItem(COACHING_LEVEL_KEY);
  return raw === "minimal" || raw === "encouraging" ? raw : "standard";
}

export function saveCoachingLevel(level: CoachingLevel): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COACHING_LEVEL_KEY, level);
}

/** True once a clinician has completed /setup on this device. */
export function loadSetupComplete(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SETUP_COMPLETE_KEY) === "true";
}

export function saveSetupComplete(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETUP_COMPLETE_KEY, String(value));
}

/**
 * Wipe everything the clinician /setup flow saved on this device — voice,
 * coaching verbosity, and the setup-complete flag — so the app falls back to
 * its defaults. Used by the "Clear clinician settings" badge.
 */
export function clearClinicianSettings(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COACH_VOICE_KEY);
  window.localStorage.removeItem(COACHING_LEVEL_KEY);
  window.localStorage.removeItem(SETUP_COMPLETE_KEY);
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

/**
 * Per-device green-floor (baseline) in dB SPL. Set by the clinician during
 * /setup and ratcheted up as the patient improves; falls back to the provided
 * default when uncalibrated. Returns `fallback` if no deviceId yet.
 */
export function loadDeviceBaseline(
  deviceId: string | null,
  fallback: number,
): number {
  if (typeof window === "undefined" || !deviceId) return fallback;
  const raw = window.localStorage.getItem(DEVICE_BASELINE_KEY_PREFIX + deviceId);
  return raw ? parseFloat(raw) : fallback;
}

export function saveDeviceBaseline(deviceId: string, floorDb: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DEVICE_BASELINE_KEY_PREFIX + deviceId,
    String(floorDb),
  );
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
