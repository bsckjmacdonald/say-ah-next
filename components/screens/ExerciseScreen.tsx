"use client";

// ============================================================================
// ExerciseScreen — the rep itself.
//
// This is the only screen with the audio loop running. It owns refs for the
// meter, duration display, and live strip chart so the audio analyser hook
// can update them at 60 fps without re-rendering React.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { RT_FEEDBACK_ENABLED, TOTAL_REPS } from "@/lib/constants";
import { AudioMeter, AudioMeterHandle } from "@/components/AudioMeter";
import { HardwareLimitedBanner } from "@/components/HardwareLimitedBanner";
import {
  DurationDisplay,
  DurationDisplayHandle,
} from "@/components/DurationDisplay";
import {
  LiveStripChart,
  LiveStripChartHandle,
} from "@/components/StripChart";
import { ProgressBar } from "@/components/ProgressBar";
import {
  evaluateRealtimeFeedback,
  freshRealtimeState,
  ALL_RT_PHRASES,
} from "@/lib/realtimeFeedback";
import type { RealtimeFeedbackState } from "@/lib/realtimeFeedback";
import { loadCoachEnabled, loadCoachVoice } from "@/lib/storage";
import { coachVoice } from "@/lib/coachVoice";
import type { UseAudioAnalyser } from "@/hooks/useAudioAnalyser";
import type { RepCompletion } from "@/lib/types";

const COACH_CUE_HOLD_MS = 2500;

interface Props {
  currentRep: number;
  /** Tip from the previous rep — fades out after 5 s. */
  tip: string | null;
  analyser: UseAudioAnalyser;
  onRepComplete: (completion: RepCompletion) => void;
}

export function ExerciseScreen({
  currentRep,
  tip,
  analyser,
  onRepComplete,
}: Props) {
  const meterRef = useRef<AudioMeterHandle>(null);
  const durationRef = useRef<DurationDisplayHandle>(null);
  const stripRef = useRef<LiveStripChartHandle>(null);
  const stopBtnRef = useRef<HTMLButtonElement>(null);

  // Real-time coach state — held in refs so the per-frame analyser callbacks
  // can read/mutate without triggering re-renders. The latest RMS is cached
  // by onLevel and consumed by onElapsed, which has the elapsed time the
  // evaluator needs (both fire in the same animation frame, in that order).
  const latestRmsRef = useRef(0);
  const realtimeStateRef = useRef<RealtimeFeedbackState>(freshRealtimeState());

  // Pre-onset prompt switches to "Keep going" once voice is detected.
  const [prompt, setPrompt] = useState("Get ready... then say Ahhh");
  const [showTip, setShowTip] = useState(!!tip);

  // Coach cue rendered as transient on-screen text. The TTS path is opt-in
  // (toggled on the welcome screen) — clinician feedback was that the
  // in-rep voice was distracting at default settings, so text wins by default.
  const [coachCue, setCoachCue] = useState<string | null>(null);
  const coachCueTimerRef = useRef<number | null>(null);
  const speakCoachCuesRef = useRef(false);
  useEffect(() => {
    speakCoachCuesRef.current = loadCoachEnabled();
    // Use the clinician-selected voice and warm the cue cache so the first cue
    // plays instantly (and from Kokoro, not the Web Speech fallback).
    coachVoice.setVoice(loadCoachVoice());
    if (speakCoachCuesRef.current) void coachVoice.prewarm(ALL_RT_PHRASES);
  }, []);

  // Start the analyser loop on mount, restart whenever the rep number changes.
  useEffect(() => {
    meterRef.current?.reset();
    durationRef.current?.reset();
    stripRef.current?.reset();
    realtimeStateRef.current = freshRealtimeState();
    latestRmsRef.current = 0;
    setPrompt("Get ready... then say Ahhh");
    setCoachCue(null);
    if (coachCueTimerRef.current !== null) {
      window.clearTimeout(coachCueTimerRef.current);
      coachCueTimerRef.current = null;
    }

    analyser.start(
      {
        onLevel: (rms) => {
          latestRmsRef.current = rms;
          meterRef.current?.setLevel(rms);
        },
        onElapsed: (sec) => {
          durationRef.current?.setSeconds(sec);
          if (RT_FEEDBACK_ENABLED) {
            const phrase = evaluateRealtimeFeedback(
              sec,
              latestRmsRef.current,
              realtimeStateRef.current,
              performance.now(),
            );
            if (phrase) {
              setCoachCue(phrase);
              if (coachCueTimerRef.current !== null) {
                window.clearTimeout(coachCueTimerRef.current);
              }
              coachCueTimerRef.current = window.setTimeout(() => {
                setCoachCue(null);
                coachCueTimerRef.current = null;
              }, COACH_CUE_HOLD_MS);
              // Opt-in TTS via the Kokoro coach voice. Spoken at natural speed
              // (1.0) — the old Web Speech path pushed rate/pitch up to sound
              // energetic, which clinicians reported as rushed and jarring.
              // Pre-warmed phrases play instantly from cache.
              if (speakCoachCuesRef.current) {
                void coachVoice.speak(phrase);
              }
            }
          }
        },
        onStripUpdate: (buf) => stripRef.current?.draw(buf),
        onOnset: () => setPrompt("Keep going... Ahhh"),
      },
      onRepComplete,
    );

    setTimeout(() => stopBtnRef.current?.focus(), 100);

    // Cleanup happens via the analyser hook itself; calling start again here
    // resets the rep accumulator. We don't return a cleanup that calls stop()
    // because that would interrupt rep completion handling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRep]);

  // Fade out the carryover tip after 5 s
  useEffect(() => {
    if (!tip) return;
    setShowTip(true);
    const t = setTimeout(() => setShowTip(false), 5000);
    return () => clearTimeout(t);
  }, [tip, currentRep]);

  // Clear any pending coach-cue timer on unmount so it can't fire after the
  // screen is gone.
  useEffect(() => {
    return () => {
      if (coachCueTimerRef.current !== null) {
        window.clearTimeout(coachCueTimerRef.current);
        coachCueTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="screen exercise-screen">
      <ProgressBar currentRep={currentRep} />
      <div className="exercise-header">
        <div className="exercise-rep-number">
          Round {currentRep} of {TOTAL_REPS}
        </div>
        <p className="keep-going-text">{prompt}</p>
        <div
          className="exercise-coach-cue"
          style={{ opacity: coachCue ? 1 : 0 }}
          aria-live="polite"
        >
          {coachCue ?? " "}
        </div>
      </div>
      {tip && (
        <div
          className="exercise-tip"
          style={{
            opacity: showTip ? 1 : 0,
            display: showTip ? "block" : "none",
          }}
        >
          {tip}
        </div>
      )}
      <HardwareLimitedBanner status={analyser.constraintStatus} />
      <DurationDisplay ref={durationRef} />
      <div className="meter-chart-row">
        <AudioMeter ref={meterRef} />
        <LiveStripChart ref={stripRef} />
      </div>
      <button
        ref={stopBtnRef}
        className="btn-secondary"
        onClick={analyser.stop}
      >
        Done — Stop
      </button>
    </div>
  );
}
