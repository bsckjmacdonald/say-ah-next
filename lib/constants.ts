// ============================================================================
// SAY AH — CONFIGURATION
// All values direct-ported from say_ah.html prototype.
// Tweaking these is the main lever for tuning the exercise; keep comments aligned.
// ============================================================================

export const TOTAL_REPS = 15;
export const TARGET_DURATION_SECONDS = 10; // adjust after user testing
export const MAX_REP_DURATION_SECONDS = 30;

// Audio thresholds (RMS, 0–1 scale)
//
// IMPORTANT: these values were halved from the prototype's originals after
// disabling automatic gain control in useAudioAnalyser. The prototype ran on
// AGC-compressed input where the browser was silently boosting the signal,
// which inflated raw RMS by roughly 2x. Halving everything keeps the same
// relative zones (soft < target < loud) but matches the un-boosted signal
// the user actually produces. If the meter feels off again, scale all five
// of these (including CHART_MAX_LEVEL) by the same factor — they're tightly
// coupled.
export const ONSET_THRESHOLD = 0.075; // RMS to trigger start (was 0.15)
export const OFFSET_THRESHOLD = 0.04; // RMS to trigger stop  (was 0.08)
// How long the level must stay below OFFSET_THRESHOLD before we call the rep
// over. Bumped from the prototype's 800 ms because brief dips during a long
// "ahhh" were ending reps prematurely. 1500 ms gives the user time to
// recover from a momentary breath catch without making genuine endings feel
// laggy.
export const OFFSET_HOLD_MS = 1500;
// Peak RMS indicating strain. NOT halved with the others — strain detection
// depends on absolute peaks, not the soft/target/loud zoning, and we'd
// rather have a few false negatives than yell at the user incorrectly.
// Revisit if real strain stops getting flagged.
export const STRAIN_THRESHOLD = 0.85;
export const STRAIN_DURATION_PERCENT = 0.20; // fraction of rep at high level

// Audio meter zone thresholds (fraction of full scale)
// Zones cover 15 % / 70 % / 15 % of CHART_MAX_LEVEL so the green target
// band is easy to stay in — feedback indicated the prior 24/48/28 split
// made the target band feel too narrow.
export const METER_SOFT_THRESHOLD = 0.019; // below = "too soft"   → yellow (15 % of scale)
export const METER_LOUD_THRESHOLD = 0.106; // above = "quite loud" → red/orange (85 % of scale)

// Strip / result chart y-axis ceiling — levels above this are clipped to the
// top edge. Zones fill the chart: soft 15 %, target 70 %, loud 15 %.
export const CHART_MAX_LEVEL = 0.125;

// Strip chart settings
export const STRIP_INTERVAL_MS = 1000; // average window (1 s) — 1 Hz update rate
export const STRIP_MAX_POINTS = 30; // 30 × 1 s = 30 s max history (matches MAX_REP_DURATION)

// ============================================================================
// dB SPL ESTIMATION
// ============================================================================
// Web Audio gives us linear amplitude from the mic. True dB SPL requires the
// mic's sensitivity, which the browser doesn't expose. We derive the default
// offset from the typical MEMS mic spec: 94 dB SPL ≈ −26 dBFS, so full-scale
// (0 dBFS) ≈ 120 dB SPL.
//
// Real devices vary ±5–10 dB from this; calibration (Phase 4) is required for
// any quantitative clinical claim. The per-device calibrated offset, once
// measured, replaces this default — it is stored in localStorage keyed by
// deviceId (see lib/storage.ts).
export const DB_SPL_CALIBRATION_OFFSET = 90;

// Below this dB level the readout shows "—" (effectively silent / no signal).
export const DB_SPL_DISPLAY_FLOOR = 30;

// ============================================================================
// dB SPL TARGET ZONES (clinician-driven, adaptive)
// ============================================================================
// The meter and strip chart render in calibrated dB SPL — NOT in RMS fractions.
// The old RMS thresholds put the "too loud" line at ~70 dB and capped the chart
// at ~72 dB, so any healthy 75–85 dB voice was wrongly flagged "too loud" (the
// #1 clinician complaint). These dB values fix that.
//
// The green band is personalized:
//   - FLOOR = the patient's baseline, set by the clinician during /setup and
//     ratcheted up as they improve (see lib/storage baseline + useSession).
//     TARGET_FLOOR_DEFAULT_DB is only the fallback when /setup hasn't run.
//   - CEILING is an interim absolute value. An amplitude ceiling can't tell
//     healthy-loud from hyperfunction — the F0 fast-follow will refine this.
//     Until then keep it permissive so healthy 80–85 dB voices stay in green.
export const METER_AXIS_MIN_DB = 50; // bottom of the visible meter/chart
export const METER_AXIS_MAX_DB = 95; // top of the visible meter/chart
export const TARGET_FLOOR_DEFAULT_DB = 65; // fallback green floor (clinician's "starts at 65" example)
export const TARGET_CEILING_DB = 85; // interim green ceiling (above = "ease back")
export const TARGET_HEALTHY_DB = 78; // healthy sustained reference, for messaging

// Auto-ratchet: the green floor nudges UP as the patient improves, mirroring
// what the clinician does by hand ("once you pull them up this low end shifts
// up"). Conservative + always reinforcing — it only ever rises, requires
// several consecutive comfortable reps, and is capped so the green band never
// collapses. A clinician can reset it in /setup.
export const FLOOR_RATCHET_MARGIN_DB = 5; // rep must clear floor by this to count
export const FLOOR_RATCHET_AFTER_REPS = 3; // consecutive clears before a nudge
export const FLOOR_RATCHET_STEP_DB = 2; // size of each upward nudge
export const FLOOR_RATCHET_MAX_DB = TARGET_HEALTHY_DB; // floor never exceeds this

// ============================================================================
// REAL-TIME IN-FLIGHT COACH
// ============================================================================
// Short verbal cues delivered DURING phonation, mimicking what expert LSVT
// clinicians do live ("Good!", "Keep going!", "Push!"). Clinical rationale:
// see LSVT_RealTime_Feedback_AI_Training.md in the parent LSVT folder. Toggle
// off here if a particular user finds the cues distracting.
export const RT_FEEDBACK_ENABLED = true;

// First cue waits this long after onset so the user can settle into
// phonation without being talked over.
export const RT_FEEDBACK_FIRST_CUE_MS = 3000;

// Minimum gap between cues — also gives short TTS phrases time to finish
// before the next one starts.
export const RT_FEEDBACK_INTERVAL_MS = 3000;

// After this point in a rep, switch to the "near end" phrase pool
// ("Almost there!", "Strong finish!").
export const RT_FEEDBACK_NEAR_END_MS = 12000;

// Hard cap on cues per rep — prevents long reps from getting noisy. 7 cues
// at a 3 s interval covers reps up to ~24 s.
export const RT_FEEDBACK_MAX_CUES = 7;

// dB drop from recent peak that triggers a "Don't let it drop!" cue.
export const RT_FEEDBACK_DROP_DB = 3;

// Storage keys (localStorage)
export const STORAGE_KEY = "sayah_sessions";
export const PB_KEY = "sayah_personal_best";
export const SPEAK_COACH_CUES_KEY = "sayah_speak_coach_cues";
export const COACH_STORAGE_KEY = "sayah_coach_enabled";
export const DEVICE_OFFSET_KEY_PREFIX = "sayah_offset_";

// Clinician-setup settings (configured at /setup, stored per device)
export const COACH_VOICE_KEY = "sayah_coach_voice"; // Kokoro voice id
export const COACHING_LEVEL_KEY = "sayah_coaching_level"; // minimal|standard|encouraging
export const SETUP_COMPLETE_KEY = "sayah_setup_complete";
export const DEVICE_BASELINE_KEY_PREFIX = "sayah_baseline_"; // green-floor dB SPL, per device

// Zone colours — used by both the meter and the strip chart
export const ZONE_COLORS = {
  soft: "#f4c430", // yellow
  target: "#34c759", // green
  loud: "#e07b5a", // orange-red
} as const;
