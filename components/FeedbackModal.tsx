"use client";

// ============================================================================
// FeedbackModal — detailed feedback form + floating trigger button.
//
// The floating 💬 button is visible on every screen (position: fixed,
// bottom-right). Clicking it opens a modal overlay with:
//   - Role selector (SLP, PT/OT, Researcher, etc.)
//   - 1–5 star rating
//   - Three VoiceTextarea fields (what worked, what didn't, suggestion)
//   - Optional name + email
//   - Submit + Cancel + Export buttons
//
// Submit → saves to localStorage AND POSTs to Formspree (if configured).
// The Formspree payload includes all accumulated inline ratings since the
// last successful submission — so a single modal submit covers a whole
// batch of per-rep data.
// ============================================================================

import { useState } from "react";
import { VoiceTextarea } from "@/components/VoiceTextarea";
import {
  downloadFeedbackExport,
  submitToFormspree,
} from "@/lib/feedbackStore";
import type { DetailedFeedback } from "@/lib/types";

interface Props {
  currentScreen: string;
}

const ROLES = [
  "SLP (Speech-Language Pathologist)",
  "PT / OT",
  "Researcher",
  "Caregiver",
  "Patient",
  "Other",
];

export function FeedbackModal({ currentScreen }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form fields
  const [role, setRole] = useState("");
  const [stars, setStars] = useState(0);
  const [whatWorked, setWhatWorked] = useState("");
  const [whatDidnt, setWhatDidnt] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const resetForm = () => {
    setRole("");
    setStars(0);
    setWhatWorked("");
    setWhatDidnt("");
    setSuggestion("");
    setName("");
    setEmail("");
    setSubmitted(false);
  };

  const handleSubmit = async () => {
    const feedback: DetailedFeedback = {
      timestamp: new Date().toISOString(),
      screen: currentScreen,
      role,
      stars,
      whatWorked,
      whatDidnt,
      suggestion,
      name,
      email,
    };

    setSubmitting(true);
    await submitToFormspree(feedback);
    setSubmitting(false);
    setSubmitted(true);
    // Auto-close after a brief "thank you"
    setTimeout(() => {
      setIsOpen(false);
      resetForm();
    }, 1500);
  };

  const handleCancel = () => {
    setIsOpen(false);
    resetForm();
  };

  if (submitted) {
    return (
      <>
        {/* Floating trigger — hidden during success flash */}
        <div className="feedback-overlay">
          <div className="feedback-modal">
            <div className="feedback-success">
              Thank you for your feedback!
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* ── Floating trigger button ──────────────────────────────────── */}
      {!isOpen && (
        <button
          type="button"
          className="feedback-fab"
          onClick={() => setIsOpen(true)}
          aria-label="Send feedback"
          title="Send feedback"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* ── Modal overlay ────────────────────────────────────────────── */}
      {isOpen && (
        <div className="feedback-overlay" onClick={handleCancel}>
          <div
            className="feedback-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="feedback-title">Send Feedback</h3>

            {/* Role */}
            <label className="feedback-label" htmlFor="fb-role">
              Your role
            </label>
            <select
              id="fb-role"
              className="feedback-select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="">— Select —</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {/* Star rating */}
            <div className="feedback-label">Overall impression</div>
            <div className="feedback-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`feedback-star ${n <= stars ? "feedback-star-on" : ""}`}
                  onClick={() => setStars(n)}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                >
                  ★
                </button>
              ))}
            </div>

            {/* Text areas with voice input */}
            <label className="feedback-label" htmlFor="fb-worked">
              What worked well?
            </label>
            <VoiceTextarea
              id="fb-worked"
              placeholder="e.g., real-time feedback was motivating"
              value={whatWorked}
              onChange={setWhatWorked}
            />

            <label className="feedback-label" htmlFor="fb-didnt">
              What didn&apos;t work?
            </label>
            <VoiceTextarea
              id="fb-didnt"
              placeholder="e.g., volume meter felt inaccurate"
              value={whatDidnt}
              onChange={setWhatDidnt}
            />

            <label className="feedback-label" htmlFor="fb-suggestion">
              Specific suggestion
            </label>
            <VoiceTextarea
              id="fb-suggestion"
              placeholder="e.g., add a calibration step"
              value={suggestion}
              onChange={setSuggestion}
              rows={2}
            />

            {/* Name + email */}
            <div className="feedback-contact-row">
              <div>
                <label className="feedback-label" htmlFor="fb-name">
                  Name (optional)
                </label>
                <input
                  id="fb-name"
                  className="feedback-input"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="feedback-label" htmlFor="fb-email">
                  Email (optional)
                </label>
                <input
                  id="fb-email"
                  className="feedback-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="feedback-actions">
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Sending…" : "Submit"}
              </button>
              <button
                type="button"
                className="btn-small"
                style={{ background: "#ccc", color: "#333" }}
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-small"
                style={{
                  background: "transparent",
                  color: "var(--color-primary)",
                  textDecoration: "underline",
                  minWidth: "auto",
                  border: "none",
                }}
                onClick={downloadFeedbackExport}
                title="Download all feedback data as JSON"
              >
                Export all
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
