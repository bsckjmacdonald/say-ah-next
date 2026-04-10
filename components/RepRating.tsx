"use client";

// Inline rep rating — three buttons (👎 / neutral / 👍) shown on the
// result screen. One tap saves to localStorage. Disappears after tapping.
// No Formspree call — ratings piggyback on the next modal submit.

import { useState } from "react";
import { saveRating } from "@/lib/feedbackStore";
import type { FeedbackRating } from "@/lib/types";

interface Props {
  repNumber: number;
  category: string;
  duration: number;
}

export function RepRating({ repNumber, category, duration }: Props) {
  const [chosen, setChosen] = useState<-1 | 0 | 1 | null>(null);

  const handleRate = (rating: -1 | 0 | 1) => {
    setChosen(rating);
    const entry: FeedbackRating = {
      timestamp: new Date().toISOString(),
      repNumber,
      category,
      duration,
      rating,
      submitted: false,
    };
    saveRating(entry);
  };

  if (chosen !== null) {
    return (
      <div className="rep-rating rep-rating-done">
        {chosen === 1 ? "👍" : chosen === -1 ? "👎" : "😐"} Thanks!
      </div>
    );
  }

  return (
    <div className="rep-rating">
      <span className="rep-rating-label">How was this round?</span>
      <div className="rep-rating-buttons">
        <button
          type="button"
          className="rep-rating-btn"
          onClick={() => handleRate(-1)}
          aria-label="Not helpful"
        >
          👎
        </button>
        <button
          type="button"
          className="rep-rating-btn"
          onClick={() => handleRate(0)}
          aria-label="Neutral"
        >
          😐
        </button>
        <button
          type="button"
          className="rep-rating-btn"
          onClick={() => handleRate(1)}
          aria-label="Helpful"
        >
          👍
        </button>
      </div>
    </div>
  );
}
