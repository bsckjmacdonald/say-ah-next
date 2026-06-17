"use client";

import { useEffect } from "react";
import { TOTAL_REPS } from "@/lib/constants";
import { ProgressBar } from "@/components/ProgressBar";
import { CoachToggle } from "@/components/CoachToggle";
import { coachVoice } from "@/lib/coachVoice";
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
  // Warm the static coach audio (cues + post-rep fallback) for the chosen voice
  // so it's fetched/decoded before the rep needs it. These are small static
  // files — no model or synthesis involved, so cues reliably come through.
  useEffect(() => {
    if (!coachEnabled || loadCoachingLevel() === "minimal") return;
    coachVoice.setVoice(loadCoachVoice());
    void coachVoice.prefetchStatic();
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
