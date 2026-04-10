// ============================================================================
// SAY AH — REAL-TIME COACH
//
// Short verbal cues delivered DURING phonation, mimicking what expert LSVT
// clinicians do live. The full clinical rationale lives in
// LSVT_RealTime_Feedback_AI_Training.md (parent LSVT folder); the short
// version is:
//
//   - Sustained phonation is hard. Patients fade or give up without
//     real-time encouragement.
//   - Cues must be POSITIVE — never criticism — even when the user is
//     under-target ("Louder!" is delivered as a coaching push, not a "you're
//     too quiet" complaint).
//   - Cues should be SHORT bursts (1–2 words) and timed to phases of the
//     phonation: settle (3–6 s), sustain (6–12 s), near-end (12+ s).
//   - Variety matters — never repeat the same phrase twice in a row.
//
// This module is the rule-based "Phase 1" baseline from the doc. The ML/RL
// adaptive timing layer is left for later.
// ============================================================================

import { rmsToDbSpl } from "./audio";
import {
  METER_SOFT_THRESHOLD,
  RT_FEEDBACK_DROP_DB,
  RT_FEEDBACK_FIRST_CUE_MS,
  RT_FEEDBACK_INTERVAL_MS,
  RT_FEEDBACK_MAX_CUES,
  RT_FEEDBACK_NEAR_END_MS,
} from "./constants";
import { pickUnused } from "./feedback";
import type { FeedbackHistory } from "./types";

// Phrase pools, categorised exactly as the LSVT real-time feedback doc
// recommends. Always positive — no criticism phrases anywhere in this file.
const PHRASES: Record<string, string[]> = {
  early_good: ["Good!", "Yes!", "Nice start!", "That's it!"],
  mid_sustain: [
    "Keep going!",
    "You've got this!",
    "Stay strong!",
    "Keep it up!",
  ],
  push_harder: ["Push!", "Louder!", "More effort!", "Give it more!"],
  prevent_fade: ["Don't let it drop!", "Stay loud!", "Don't fade!"],
  near_end: ["Almost there!", "Just a bit more!", "Strong finish!"],
};

// "Below this dB is too soft" — derived once from the existing RMS threshold
// so the realtime coach uses the same target zone the meter visualizes.
const TARGET_LOW_DB = rmsToDbSpl(METER_SOFT_THRESHOLD);

// Per-frame smoothing so single-frame spikes don't skew the decision logic.
// At ~60 fps, alpha=0.1 gives a time constant of ~160 ms.
const RMS_SMOOTH_ALPHA = 0.1;

export interface RealtimeFeedbackState {
  smoothedRms: number;
  /** dB SPL peak since the last cue — used for drop detection. */
  peakDb: number;
  /** performance.now() timestamp of the last cue, or 0 before the first. */
  lastCueTime: number;
  cueCount: number;
  /** Deck-deal cycling state, one entry per phrase pool key. */
  deck: FeedbackHistory;
}

export function freshRealtimeState(): RealtimeFeedbackState {
  return {
    smoothedRms: 0,
    peakDb: -Infinity,
    lastCueTime: 0,
    cueCount: 0,
    deck: {},
  };
}

/**
 * Called once per audio frame after onset is detected. Returns a phrase to
 * speak if the trigger logic decides a cue is due, or `null` otherwise.
 *
 * The caller is responsible for actually playing the phrase (via TTS) and
 * for resetting the state at the start of each rep.
 */
export function evaluateRealtimeFeedback(
  elapsedSec: number,
  currentRms: number,
  state: RealtimeFeedbackState,
  nowMs: number,
): string | null {
  // Update smoothed level and rolling peak. We do this every frame, even
  // when no cue will fire, so the next eligible cue has fresh data.
  state.smoothedRms =
    state.smoothedRms * (1 - RMS_SMOOTH_ALPHA) + currentRms * RMS_SMOOTH_ALPHA;
  const dbNow = rmsToDbSpl(state.smoothedRms);
  if (dbNow > state.peakDb) state.peakDb = dbNow;

  // ── Gating ────────────────────────────────────────────────────────────
  if (state.cueCount >= RT_FEEDBACK_MAX_CUES) return null;

  const elapsedMs = elapsedSec * 1000;
  if (elapsedMs < RT_FEEDBACK_FIRST_CUE_MS) return null;

  if (
    state.lastCueTime > 0 &&
    nowMs - state.lastCueTime < RT_FEEDBACK_INTERVAL_MS
  ) {
    return null;
  }

  // ── Category selection ────────────────────────────────────────────────
  const tooSoft = dbNow < TARGET_LOW_DB;
  const dropped =
    state.cueCount > 0 && state.peakDb - dbNow >= RT_FEEDBACK_DROP_DB;
  const nearEnd = elapsedMs >= RT_FEEDBACK_NEAR_END_MS;

  let category: keyof typeof PHRASES;
  if (state.cueCount === 0) {
    // First cue: warm welcome if they're already in the zone, otherwise a
    // gentle push to bring the volume up.
    category = tooSoft ? "push_harder" : "early_good";
  } else if (nearEnd) {
    // Past the near-end threshold, stay focused on finishing strong.
    category = "near_end";
  } else if (dropped) {
    // Drop detection takes priority over generic "too soft" so we name the
    // problem instead of repeating the same push cue.
    category = "prevent_fade";
  } else if (tooSoft) {
    category = "push_harder";
  } else {
    category = "mid_sustain";
  }

  const phrase = pickUnused(state.deck, "rt." + category, PHRASES[category]);

  // Reset peak for the next interval — drop detection is "since the last
  // cue", not "since onset", so a brief earlier spike doesn't keep the
  // prevent_fade trigger latched on.
  state.lastCueTime = nowMs;
  state.cueCount++;
  state.peakDb = dbNow;

  return phrase;
}
