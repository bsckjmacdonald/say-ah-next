// ============================================================================
// SAY AH — FEEDBACK STORE
//
// localStorage-backed feedback collection with optional Google Sheets batching.
//
// Data flow:
//   1. Inline rep ratings (👎/👍) → saveRating() → localStorage only
//   2. Detailed modal submissions → saveDetailed() → localStorage + Sheets
//      The Sheets POST bundles the modal fields AND all accumulated inline
//      ratings that haven't been sent yet, so each submission covers maximum
//      data with minimum API calls.
//
// Budget: Sheets POST fires ONLY on explicit modal submits. Inline ratings
// never consume a submission on their own.
// ============================================================================

import type {
  DetailedFeedback,
  FeedbackBundle,
  FeedbackRating,
} from "./types";

// ── Google Sheets Apps Script web app URL ───────────────────────────────
// Deploy the script in docs/apps-script.gs as a web app (Execute as: Me,
// Access: Anyone) and paste the /exec URL here. When empty, the Sheets
// path is silently skipped — data is still saved locally and available
// via exportAll().
export const SHEETS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwoSrFtdViyb642pz84vbzv0tQPiZLhDCOyuqIwDJHKDyQQU-NITIkRfzu7I2HSWWpg/exec";

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

/** Mark accumulated ratings as submitted after a successful Sheets POST. */
function markRatingsSubmitted(): void {
  const ratings = loadJson<FeedbackRating[]>(RATINGS_KEY, []);
  ratings.forEach((r) => (r.submitted = true));
  storeJson(RATINGS_KEY, ratings);
}

/**
 * Submit a bundle to the Google Sheets Apps Script web app (modal fields +
 * accumulated ratings). Returns true on success, false on failure. Data is
 * always persisted locally regardless of the POST result.
 *
 * Uses Content-Type: text/plain to avoid a CORS preflight — Apps Script
 * web apps don't respond to OPTIONS. The body is still JSON; the script
 * parses it with JSON.parse(e.postData.contents).
 */
export async function submitToSheet(
  detailed: DetailedFeedback,
): Promise<boolean> {
  // Always save locally first — this is the durable record.
  saveDetailed(detailed);

  if (!SHEETS_WEBAPP_URL) return false;

  const accumulatedRatings = getUnsubmittedRatings();
  const bundle: FeedbackBundle = {
    submittedAt: new Date().toISOString(),
    userAgent: isBrowser() ? navigator.userAgent : "",
    detailed,
    accumulatedRatings,
  };

  try {
    const res = await fetch(SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bundle),
    });
    if (res.ok) {
      markRatingsSubmitted();
      return true;
    }
    console.warn("Sheets POST failed:", res.status, await res.text());
    return false;
  } catch (err) {
    console.warn("Sheets POST error:", err);
    return false;
  }
}

