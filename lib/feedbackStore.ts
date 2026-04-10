// ============================================================================
// SAY AH — FEEDBACK STORE
//
// localStorage-backed feedback collection with optional Formspree batching.
//
// Data flow:
//   1. Inline rep ratings (👎/👍) → saveRating() → localStorage only
//   2. Detailed modal submissions → saveDetailed() → localStorage + Formspree
//      The Formspree POST bundles the modal fields AND all accumulated inline
//      ratings that haven't been sent yet, so each submission covers maximum
//      data with minimum API calls.
//   3. exportAll() → returns a JSON string of everything in localStorage for
//      manual download / email backup.
//
// Budget: Formspree fires ONLY on explicit modal submits. Inline ratings
// never consume a submission on their own.
// ============================================================================

import type {
  DetailedFeedback,
  FeedbackBundle,
  FeedbackRating,
} from "./types";

// ── Formspree endpoint ──────────────────────────────────────────────────
// Create a form at https://formspree.io/forms, paste the endpoint here.
// When empty, the Formspree path is silently skipped — data is still saved
// locally and available via exportAll().
export const FORMSPREE_ENDPOINT = "https://formspree.io/f/xeepbdkv";

// ── Storage keys ────────────────────────────────────────────────────────
const RATINGS_KEY = "sayah_feedback_ratings";
const DETAILED_KEY = "sayah_feedback_detailed";

// ── Helpers ─────────────────────────────────────────────────────────────
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function loadJson<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function storeJson(key: string, value: unknown): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

// ── Public API ──────────────────────────────────────────────────────────

/** Save a single inline rep rating (👎 / neutral / 👍). */
export function saveRating(rating: FeedbackRating): void {
  const ratings = loadJson<FeedbackRating[]>(RATINGS_KEY, []);
  ratings.push(rating);
  storeJson(RATINGS_KEY, ratings);
}

/** Save a detailed feedback submission from the modal. */
export function saveDetailed(feedback: DetailedFeedback): void {
  const items = loadJson<DetailedFeedback[]>(DETAILED_KEY, []);
  items.push(feedback);
  storeJson(DETAILED_KEY, items);
}

/** Get all unsubmitted inline ratings. */
export function getUnsubmittedRatings(): FeedbackRating[] {
  return loadJson<FeedbackRating[]>(RATINGS_KEY, []).filter(
    (r) => !r.submitted,
  );
}

/** Mark accumulated ratings as submitted after a successful Formspree POST. */
function markRatingsSubmitted(): void {
  const ratings = loadJson<FeedbackRating[]>(RATINGS_KEY, []);
  ratings.forEach((r) => (r.submitted = true));
  storeJson(RATINGS_KEY, ratings);
}

/**
 * Submit a bundle to Formspree (modal fields + accumulated ratings).
 * Returns true on success, false on failure. Data is always persisted
 * locally regardless of the POST result.
 */
export async function submitToFormspree(
  detailed: DetailedFeedback,
): Promise<boolean> {
  // Always save locally first — this is the durable record.
  saveDetailed(detailed);

  if (!FORMSPREE_ENDPOINT) return false;

  const accumulatedRatings = getUnsubmittedRatings();
  const bundle: FeedbackBundle = {
    submittedAt: new Date().toISOString(),
    userAgent: isBrowser() ? navigator.userAgent : "",
    detailed,
    accumulatedRatings,
  };

  try {
    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(bundle),
    });
    if (res.ok) {
      markRatingsSubmitted();
      return true;
    }
    console.warn("Formspree POST failed:", res.status, await res.text());
    return false;
  } catch (err) {
    console.warn("Formspree POST error:", err);
    return false;
  }
}

/**
 * Export all collected feedback as a downloadable JSON string.
 * Includes ratings (submitted and not), detailed feedback, and session
 * history — everything needed for offline analysis.
 */
export function exportAll(): string {
  const ratings = loadJson<FeedbackRating[]>(RATINGS_KEY, []);
  const detailed = loadJson<DetailedFeedback[]>(DETAILED_KEY, []);
  return JSON.stringify({ exportedAt: new Date().toISOString(), ratings, detailed }, null, 2);
}

/** Trigger a JSON file download of all feedback data. */
export function downloadFeedbackExport(): void {
  if (!isBrowser()) return;
  const json = exportAll();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sayah-feedback-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
