"use client";

// ============================================================================
// SAY AH — SESSION STATE HOOK
//
// Owns everything that lives across reps within a session, plus the personal
// best (which spans sessions). Replaces the prototype's three top-level `let`
// objects (sessionState / repState / etc).
//
// `feedbackHistory` is held in a ref because the deck-deal picker mutates it
// in place — we don't want a re-render every time a feedback message is shown.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  generateFeedback,
  generateSessionCompleteMessage,
  determineFeedbackCategory,
} from "@/lib/feedback";
import {
  loadHistory,
  loadPersonalBest,
  saveSession,
  savePersonalBest,
} from "@/lib/storage";
import type {
  FeedbackHistory,
  FeedbackResult,
  RepCompletion,
  SessionRecord,
} from "@/lib/types";

export interface RepResult {
  repNumber: number;
  duration: number;
  feedback: FeedbackResult;
  stripBuffer: number[];
  category: ReturnType<typeof determineFeedbackCategory>["category"];
  /** Recorded audio for playback on the result screen, if available. */
  audioUrl?: string;
}

export interface UseSession {
  userName: string;
  setUserName: (name: string) => void;
  currentRep: number;
  durations: number[];
  loudness: number[];
  personalBest: number;
  history: SessionRecord[];
  /** Tip from the previous rep, shown briefly on the next exercise screen. */
  nextRepTip: string | null;
  startSession: () => void;
  /** Process a finished rep, returning the feedback to display. */
  completeRep: (completion: RepCompletion) => RepResult;
  /** Advance to the next rep. */
  advanceRep: () => void;
  /** Persist the session and return the summary message. */
  finishSession: () => string;
  reset: () => void;
  refreshHistory: () => void;
}

export function useSession(totalReps: number): UseSession {
  const [userName, setUserName] = useState("");
  const [currentRep, setCurrentRep] = useState(0);
  const [durations, setDurations] = useState<number[]>([]);
  const [loudness, setLoudness] = useState<number[]>([]);
  const [personalBest, setPersonalBest] = useState(0);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [nextRepTip, setNextRepTip] = useState<string | null>(null);

  // Mutable cycling state for the deck-deal feedback picker
  const feedbackHistoryRef = useRef<FeedbackHistory>({});

  // Hydrate from localStorage after mount. Reading localStorage during
  // render isn't safe (Next.js SSR would mismatch on hydration), so the
  // one-time setState here is necessary even though React 19's lint rule
  // flags it. This is exactly the "subscribe to an external system" case
  // useEffect is designed for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPersonalBest(loadPersonalBest());
    setHistory(loadHistory());
  }, []);

  const startSession = useCallback(() => {
    setCurrentRep(1);
    setDurations([]);
    setLoudness([]);
    setNextRepTip(null);
    feedbackHistoryRef.current = {};
  }, []);

  const completeRep = useCallback(
    (completion: RepCompletion): RepResult => {
      const {
        duration,
        avgRMS,
        peakRMS,
        highAmplitudeTime,
        stripBuffer,
        audioUrl,
      } = completion;

      // Use a functional setter so we have an authoritative "previous" view
      // even if React batches multiple completions (shouldn't happen, but
      // safer than reading the closed-over `durations`).
      const prevDurations = durations;
      const prevLoudness = loudness;

      const { category, newPersonalBest } = determineFeedbackCategory(
        duration,
        prevDurations,
        avgRMS,
        peakRMS,
        highAmplitudeTime,
        prevLoudness,
        personalBest,
      );

      if (newPersonalBest > personalBest) {
        setPersonalBest(newPersonalBest);
        savePersonalBest(newPersonalBest);
      }

      const feedback = generateFeedback(
        {
          name: userName,
          duration,
          repNumber: currentRep,
          allDurations: prevDurations,
          personalBest,
          avgRMS,
          allLoudness: prevLoudness,
          category,
        },
        feedbackHistoryRef.current,
      );

      setDurations((d) => [...d, duration]);
      setLoudness((l) => [...l, avgRMS]);

      // Tip from this rep is shown briefly on the next exercise screen
      if (currentRep < totalReps) setNextRepTip(feedback.tip);

      return {
        repNumber: currentRep,
        duration,
        feedback,
        stripBuffer,
        category,
        audioUrl,
      };
    },
    [currentRep, durations, loudness, personalBest, totalReps, userName],
  );

  const advanceRep = useCallback(() => {
    setCurrentRep((r) => (r < totalReps ? r + 1 : r));
  }, [totalReps]);

  const finishSession = useCallback(() => {
    saveSession(durations);
    setHistory(loadHistory());
    return generateSessionCompleteMessage(userName, durations);
  }, [durations, userName]);

  const reset = useCallback(() => {
    setCurrentRep(0);
    setDurations([]);
    setLoudness([]);
    setNextRepTip(null);
  }, []);

  const refreshHistory = useCallback(() => {
    setHistory(loadHistory());
  }, []);

  return {
    userName,
    setUserName,
    currentRep,
    durations,
    loudness,
    personalBest,
    history,
    nextRepTip,
    startSession,
    completeRep,
    advanceRep,
    finishSession,
    reset,
    refreshHistory,
  };
}
