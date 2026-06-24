// ============================================================================
// SAY AH — AUDIO MATH
//
// Pure RMS ↔ dB helpers. See constants.ts for the calibration discussion —
// short version: browsers can't give us true SPL, so the dB SPL value here
// is an estimate produced by adding a fixed offset to dBFS. Useful as a
// relative within-session indicator, not for clinical measurement.
// ============================================================================

import { DB_SPL_CALIBRATION_OFFSET } from "./constants";

// Floor for log() — anything quieter is treated as "infinitely quiet" and
// produces a very negative dBFS value that the display layer floors out.
const SILENCE_FLOOR = 1e-7;

// Active calibration offset. Defaults to the generic constant, but is replaced
// at runtime with the per-device calibrated offset once known (see
// setActiveCalibrationOffset, called from the app when the mic deviceId
// resolves). All dB SPL conversions below read this, so the meter, chart, zone
// decisions, and coach cues all use the same calibrated value.
let activeOffset = DB_SPL_CALIBRATION_OFFSET;

/** Replace the active calibration offset (per-device, from /setup). */
export function setActiveCalibrationOffset(offset: number): void {
  activeOffset = offset;
}

/** The offset currently used for dB SPL conversions. */
export function getActiveCalibrationOffset(): number {
  return activeOffset;
}

/** RMS amplitude (0–1) → dBFS (−∞ to 0). */
export function rmsToDbFs(rms: number): number {
  return 20 * Math.log10(Math.max(rms, SILENCE_FLOOR));
}

/** dBFS → estimated dB SPL using the active calibration offset. */
export function dbFsToDbSpl(dbFs: number): number {
  return dbFs + activeOffset;
}

/** Convenience: RMS amplitude (0–1) → estimated dB SPL. */
export function rmsToDbSpl(rms: number): number {
  return dbFsToDbSpl(rmsToDbFs(rms));
}

/** Inverse of rmsToDbSpl: estimated dB SPL → RMS amplitude (0–1). */
export function dbSplToRms(dbSpl: number): number {
  return Math.pow(10, (dbSpl - activeOffset) / 20);
}
