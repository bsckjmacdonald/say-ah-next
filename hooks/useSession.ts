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
  loadDeviceBaseline,
  saveDeviceBaseline,
  saveSession,
  savePersonalBest,
} from "@/lib/storage";
import { rmsToDbSpl } from "@/lib/audio";
import {
  FLOOR_RATCHET_AFTER_REPS,
  FLOOR_RATCHET_MARGIN_DB,
  FLOOR_RATCHET_MAX_DB,
  FLOOR_RATCHET_STEP_DB,
  TARGET_FLOOR_DEFAULT_DB,
} from "@/lib/constants";
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
  /** Current green-zone floor in dB SPL (adaptive, per-patient). */
  floorDb: number;
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

export function useSession(
  totalReps: number,
  deviceId: string | null,
): UseSession {
  const [userName, setUserName] = useState("");
  const [currentRep, setCurrentRep] = useState(0);
  const [durations, setDurations] = useState<number[]>([]);
  const [loudness, setLoudness] = useState<number[]>([]);
  const [personalBest, setPersonalBest] = useState(0);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [floorDb, setFloorDb] = useState(TARGET_FLOOR_DEFAULT_DB);
  const [nextRepTip, setNextRepTip] = useState<string | null>(null);

  // Mutable cycling state for the deck-deal feedback picker
  const feedbackHistoryRef = useRef<FeedbackHistory>({});

  // Count of consecutive reps that cleared the floor comfortably — drives the
  // upward ratchet.
  const consecutiveClearsRef = useRef(0);

  // Hydrate from localStorage after mount. Reading localStorage during
  // render isn't safe (Next.js SSR would mismatch on hydration), so the
  // one-time setState here is necessary even though React 19's lint rule
  // flags it. This is exactly the "subscribe to an external system" case
  // useEffect is designed for.
  useEffect(() => {
    setPersonalBest(loadPersonalBest());
    setHistory(loadHistory());
  }, []);

  // Load the per-device green floor once the mic deviceId resolves (clinician
  // baseline from /setup, or the ratcheted value from a prior session). Falls
  // back to the default until then.
  useEffect(() => {
    setFloorDb(loadDeviceBaseline(deviceId, TARGET_FLOOR_DEFAULT_DB));
  }, [deviceId]);

  const startSession = useCallback(() => {
    setCurrentRep(1);
    setDurations([]);
    setLoudness([]);
    setNextRepTip(null);
    feedbackHistoryRef.current = {};
    consecutiveClearsRef.current = 0;
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
        floorDb,
      );

      if (newPersonalBest > personalBest) {
        setPersonalBest(newPersonalBest);
        savePersonalBest(newPersonalBest);
      }

      // ── Adaptive floor ratchet ──────────────────────────────────────────
      // A rep "clears" the floor when it sits comfortably above it and isn't
      // too loud. After several consecutive clears, nudge the floor up (capped)
      // and persist so the patient keeps the gain next session. Always rises,
      // never falls; a clinician can reset it in /setup.
      const avgDb = rmsToDbSpl(avgRMS);
      const cleared =
        category !== "too_soft" &&
        category !== "too_loud" &&
        avgDb >= floorDb + FLOOR_RATCHET_MARGIN_DB;
      consecutiveClearsRef.current = cleared
        ? consecutiveClearsRef.current + 1
        : 0;
      if (
        consecutiveClearsRef.current >= FLOOR_RATCHET_AFTER_REPS &&
        floorDb < FLOOR_RATCHET_MAX_DB
      ) {
        const nextFloor = Math.min(
          floorDb + FLOOR_RATCHET_STEP_DB,
          FLOOR_RATCHET_MAX_DB,
        );
        setFloorDb(nextFloor);
        if (deviceId) saveDeviceBaseline(deviceId, nextFloor);
        consecutiveClearsRef.current = 0;
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
    [
      currentRep,
      durations,
      loudness,
      personalBest,
      totalReps,
      userName,
      deviceId,
      floorDb,
    ],
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
    floorDb,
    nextRepTip,
    startSession,
    completeRep,
    advanceRep,
    finishSession,
    reset,
    refreshHistory,
  };
}
