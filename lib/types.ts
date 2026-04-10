// ============================================================================
// SAY AH — SHARED TYPES
// ============================================================================

export type ScreenId =
  | "welcome"
  | "mic-permission"
  | "pre-rep"
  | "exercise"
  | "rep-result"
  | "session-complete"
  | "history";

export type FeedbackCategory =
  | "too_soft"
  | "too_loud"
  | "personal_best"
  | "great"
  | "good"
  | "keep_trying"
  | "tiring";

export interface FeedbackResult {
  spoken: string;
  display: string;
  tip: string | null;
}

export interface FeedbackParams {
  name: string;
  duration: number;
  repNumber: number;
  allDurations: number[];
  personalBest: number;
  avgRMS: number;
  allLoudness: number[];
  category: FeedbackCategory;
}

// Per-feedback-key cycling state for the deck-deal picker
export interface FeedbackHistoryEntry {
  order: number[];
  pos: number;
}
export type FeedbackHistory = Record<string, FeedbackHistoryEntry>;

export interface SessionRecord {
  date: string; // ISO
  durations: number[];
  average: number;
  best: number;
}

// ============================================================================
// FEEDBACK TYPES
// ============================================================================

/** Inline rep rating — captured on the result screen with one tap. */
export interface FeedbackRating {
  timestamp: string; // ISO
  repNumber: number;
  category: string;
  duration: number;
  rating: -1 | 0 | 1; // thumbs down / neutral / thumbs up
  submitted: boolean; // true once included in a Formspree batch
}

/** Detailed feedback from the modal form. */
export interface DetailedFeedback {
  timestamp: string; // ISO
  screen: string; // which screen the user was on
  role: string; // SLP, PT/OT, Researcher, Caregiver, Patient, Other
  stars: number; // 1–5
  whatWorked: string;
  whatDidnt: string;
  suggestion: string;
  name: string;
  email: string;
}

/** Bundle sent to Formspree — one POST per modal submission. */
export interface FeedbackBundle {
  submittedAt: string;
  userAgent: string;
  detailed: DetailedFeedback;
  accumulatedRatings: FeedbackRating[];
}

export interface RepCompletion {
  duration: number;
  avgRMS: number;
  peakRMS: number;
  highAmplitudeTime: number;
  stripBuffer: number[];
  /**
   * Object URL for the audio blob recorded during this rep, or undefined if
   * MediaRecorder is unavailable / failed. Caller is responsible for
   * revoking the URL when it's no longer needed.
   */
  audioUrl?: string;
}
