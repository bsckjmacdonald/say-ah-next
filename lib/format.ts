// ============================================================================
// SAY AH — FORMATTING HELPERS
// ============================================================================

/**
 * Round a duration in seconds to a whole number and format with the
 * singular/plural unit. "1 second" vs "12 seconds". Used by the feedback
 * engine, the result screen, and the history list.
 *
 * Rounding is intentional — fractional seconds (12.3, 12.7) are harder to
 * read aloud and carry no real signal for the patient. Whole numbers feel
 * cleaner and are easier to remember round-over-round.
 */
export function formatSeconds(seconds: number): string {
  const n = Math.round(seconds);
  return `${n} second${n === 1 ? "" : "s"}`;
}
