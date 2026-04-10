"use client";

import { TOTAL_REPS } from "@/lib/constants";
import { ProgressBar } from "@/components/ProgressBar";

interface Props {
  currentRep: number;
  tip: string | null;
  onStart: () => void;
}

export function PreRepScreen({ currentRep, tip, onStart }: Props) {
  return (
    <div className="screen" style={{ gap: 32 }}>
      <ProgressBar currentRep={currentRep} />
      <div className="content-wrapper">
        <h2 className="pre-rep-number">
          Round {currentRep} of {TOTAL_REPS}
        </h2>
        <p className="instruction-text">
          Take a breath, then say &quot;Ahhh&quot; as long and as comfortably
          as you can.
        </p>
        {tip && <div className="pre-rep-tip">{tip}</div>}
        <button
          className="btn-primary"
          onClick={onStart}
          style={{ marginTop: 40 }}
          autoFocus
        >
          I&apos;m Ready — Start
        </button>
      </div>
    </div>
  );
}
