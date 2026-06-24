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
} from "@/lib/realtimeFeedback";
import type { RealtimeFeedbackState } from "@/lib/realtimeFeedback";
import {
  loadCoachEnabled,
  loadCoachVoice,
  loadCoachingLevel,
} from "@/lib/storage";
import { coachVoice } from "@/lib/coachVoice";
import type { UseAudioAnalyser } from "@/hooks/useAudioAnalyser";
import type { RepCompletion } from "@/lib/types";

const COACH_CUE_HOLD_MS = 2500;

interface Props {
  currentRep: number;
  /** Tip from the previous rep — fades out after 5 s. */
  tip: string | null;
  analyser: UseAudioAnalyser;
  /** Adaptive green-zone floor (dB SPL) for the meter, chart, and cues. */
  floorDb: number;
  onRepComplete: (completion: RepCompletion) => void;
}

export function ExerciseScreen({
  currentRep,
  tip,
  analyser,
  floorDb,
  onRepComplete,
}: Props) {
  // Read the latest floor inside the per-frame analyser callbacks without
  // re-subscribing the loop (it can ratchet up mid-session).
  const floorDbRef = useRef(floorDb);
  useEffect(() => {
    floorDbRef.current = floorDb;
  }, [floorDb]);
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
    // Spoken cues require the coach toggle on AND a coaching level above
    // "minimal" (clinician setting from /setup; "minimal" = visual cue only).
    // Cues are pre-synthesized on the pre-rep screen (see PreRepScreen) so they
    // play from cache here — synthesizing them on this screen would freeze the
    // meter, since Kokoro runs on the main thread.
    speakCoachCuesRef.current =
      loadCoachEnabled() && loadCoachingLevel() !== "minimal";
    coachVoice.setVoice(loadCoachVoice());
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
              floorDbRef.current,
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
              // Cue plays from its pre-generated static file (always available,
              // instant, in the chosen voice). Selection is still live, so it's
              // responsive — just reliably audible now.
              if (speakCoachCuesRef.current) {
                void coachVoice.speakCue(phrase);
              }
            }
          }
        },
        onStripUpdate: (buf) => stripRef.current?.draw(buf),
        onOnset: () => {
          setPrompt("Keep going... Ahhh");
          meterRef.current?.setOnsetDetected(true);
          stripRef.current?.setOnsetDetected(true);
        },
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
        <AudioMeter ref={meterRef} floorDb={floorDb} />
        <LiveStripChart ref={stripRef} floorDb={floorDb} />
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
