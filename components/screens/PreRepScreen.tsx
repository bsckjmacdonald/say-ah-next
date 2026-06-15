"use client";

import { useEffect } from "react";
import { TOTAL_REPS } from "@/lib/constants";
import { ProgressBar } from "@/components/ProgressBar";
import { CoachToggle } from "@/components/CoachToggle";
import { coachVoice } from "@/lib/coachVoice";
import { ALL_RT_PHRASES } from "@/lib/realtimeFeedback";
import { ALL_POST_REP_SPOKEN } from "@/lib/feedback";
import { loadCoachVoice, loadCoachingLevel } from "@/lib/storage";

interface Props {
  currentRep: number;
  tip: string | null;
  coachEnabled: boolean;
  onCoachToggle: (value: boolean) => void;
  onStart: () => void;
}

export function PreRepScreen({
  currentRep,
  tip,
  coachEnabled,
  onCoachToggle,
  onStart,
}: Props) {
  // Pre-synthesize the coach cue pool here, on this static "get ready" screen,
  // so the rep itself plays them from cache. Kokoro runs on the main thread, so
  // doing this during the rep would freeze the meter. The model is already
  // loaded (from /setup); after the first round these are all cached, so this
  // is a no-op on later rounds.
  useEffect(() => {
    if (!coachEnabled || loadCoachingLevel() === "minimal") return;
    coachVoice.setVoice(loadCoachVoice());
    // Cues first (needed during the rep), then the short post-rep phrases.
    void coachVoice.prewarm([...ALL_RT_PHRASES, ...ALL_POST_REP_SPOKEN]);
  }, [coachEnabled]);
  return (
    <div className="screen pre-rep-screen">
      <ProgressBar currentRep={currentRep} />
      <div className="content-wrapper">
        <h2 className="pre-rep-number">
          Round {currentRep} of {TOTAL_REPS}
        </h2>
        <p className="instruction-text">
          Say &quot;Ahhh&quot; as long and as comfortably as you can.
        </p>
        <p className="pre-rep-mic-distance">
          Hold your phone about 12 in (30 cm) from your mouth.
        </p>
        {tip && <div className="pre-rep-tip">{tip}</div>}
        <CoachToggle enabled={coachEnabled} onToggle={onCoachToggle} />
        <button
          className="btn-primary"
          onClick={onStart}
          style={{ marginTop: 24 }}
          autoFocus
        >
          I&apos;m Ready — Start
        </button>
      </div>
    </div>
  );
}
