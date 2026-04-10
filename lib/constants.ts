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
export const METER_SOFT_THRESHOLD = 0.03; // below = "too soft"   → yellow (was 0.06)
export const METER_LOUD_THRESHOLD = 0.09; // above = "quite loud" → red/orange (was 0.18)

// Strip / result chart y-axis ceiling — levels above this are clipped to the
// top edge. Halved with the meter thresholds so the three zones still fill
// the chart in the same proportions (soft 24 %, target 48 %, loud 28 %).
export const CHART_MAX_LEVEL = 0.125;

// Strip chart settings
export const STRIP_INTERVAL_MS = 500; // average window (0.5 s)
export const STRIP_MAX_POINTS = 36; // 36 × 0.5 s = 18 s of history shown

// ============================================================================
// dB SPL ESTIMATION
// ============================================================================
// Web Audio gives us linear amplitude (0–1) from the mic, NOT absolute sound
// pressure. True dB SPL requires knowing the mic's sensitivity (mV/Pa) and
// the signal-chain gain — neither is exposed by the browser. We apply a
// fixed 94 dB offset (the standard 1 Pa reference) which produces
// psychologically plausible readings (~50–70 dB at conversational distance
// with a typical laptop mic at default gain).
//
// Treat the displayed value as a RELATIVE indicator useful for tracking
// change within a session — not a calibrated clinical SPL measurement. If a
// per-device calibration step is added later, change this offset to absorb
// the user's reference reading.
export const DB_SPL_CALIBRATION_OFFSET = 94;

// Below this dB level the readout shows "—" (effectively silent / no signal).
export const DB_SPL_DISPLAY_FLOOR = 30;

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

// Zone colours — used by both the meter and the strip chart
export const ZONE_COLORS = {
  soft: "#f4c430", // yellow
  target: "#34c759", // green
  loud: "#e07b5a", // orange-red
} as const;
