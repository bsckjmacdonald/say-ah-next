// ============================================================================
// SAY AH — TARGET BAND / CALIBRATION
//
// The "target band" is the range of loudness a rep should land in, expressed
// in raw RMS (0–1) — NOT dB SPL. Absolute SPL is unreliable across devices and
// impossible in-browser on iOS, so instead a clinician calibrates the band by
// ear, per session, by capturing the patient's voice on the device in use.
//
// A band has four thresholds, but only two are CAPTURED:
//   - soft  (bottom of the band, captured): below = "too soft"
//   - loud  (top of the band, captured or derived): above = "too loud"/strain
// The other two are DERIVED from the captured anchors so the whole detection
// pipeline scales with the band (see ONSET/OFFSET_SPAN_FRACTION):
//   - onset  (must exceed to start a rep)
//   - offset (held below → rep ends; silence detection)
//
// When uncalibrated, DEFAULT_BAND reproduces the legacy constants exactly, so
// behaviour is unchanged for anyone who never opens the calibrate screen.
// ============================================================================

import {
  METER_LOUD_THRESHOLD,
  METER_SOFT_THRESHOLD,
  OFFSET_SPAN_FRACTION,
  OFFSET_THRESHOLD,
  ONSET_SPAN_FRACTION,
  ONSET_THRESHOLD,
} from "./constants";

export interface TargetBand {
  /** Bottom of the band (RMS). Below this a rep is "too soft". */
  soft: number;
  /** Top of the band (RMS). Above this a rep is "too loud"/straining. */
  loud: number;
  /** Must be exceeded for a rep to start (RMS). Derived from anchors. */
  onset: number;
  /** Held below for OFFSET_HOLD_MS → rep ends (RMS). Derived from anchors. */
  offset: number;
}

// The uncalibrated band — identical to the legacy hard-coded constants, so an
// uncalibrated session behaves exactly as it did before calibration existed.
export const DEFAULT_BAND: TargetBand = {
  soft: METER_SOFT_THRESHOLD,
  loud: METER_LOUD_THRESHOLD,
  onset: ONSET_THRESHOLD,
  offset: OFFSET_THRESHOLD,
};

// The default span between anchors, used when deriving a loud anchor from soft
// alone (the "derive the top" path — e.g. over Zoom, where the clinician can't
// demo into the patient's device and we don't want the patient to strain).
const DEFAULT_SPAN = METER_LOUD_THRESHOLD - METER_SOFT_THRESHOLD;

/**
 * Build a full band from the two captured anchors. onset/offset are derived by
 * fixed fractions of the soft→loud span so they always sit coherently inside
 * the band, regardless of device sensitivity.
 */
export function bandFromAnchors(soft: number, loud: number): TargetBand {
  const lo = Math.min(soft, loud);
  const hi = Math.max(soft, loud);
  const span = hi - lo;
  return {
    soft: lo,
    loud: hi,
    onset: lo + ONSET_SPAN_FRACTION * span,
    offset: lo + OFFSET_SPAN_FRACTION * span,
  };
}

/**
 * Derive a loud anchor from the soft anchor alone, for when the top isn't
 * captured. Keeps the band the same width as the default band.
 */
export function deriveLoudFromSoft(soft: number): number {
  return soft + DEFAULT_SPAN;
}

/** Median of a list of samples. Robust to the wobble in Parkinson's phonation. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Basic sanity: a usable band has a soft anchor strictly below the loud one. */
export function isBandValid(band: TargetBand): boolean {
  return (
    Number.isFinite(band.soft) &&
    Number.isFinite(band.loud) &&
    band.soft > 0 &&
    band.loud > band.soft
  );
}
