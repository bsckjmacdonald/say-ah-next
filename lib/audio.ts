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

/** RMS amplitude (0–1) → dBFS (−∞ to 0). */
export function rmsToDbFs(rms: number): number {
  return 20 * Math.log10(Math.max(rms, SILENCE_FLOOR));
}

/** dBFS → estimated dB SPL using the fixed calibration offset. */
export function dbFsToDbSpl(dbFs: number): number {
  return dbFs + DB_SPL_CALIBRATION_OFFSET;
}

/** Convenience: RMS amplitude (0–1) → estimated dB SPL. */
export function rmsToDbSpl(rms: number): number {
  return dbFsToDbSpl(rmsToDbFs(rms));
}
