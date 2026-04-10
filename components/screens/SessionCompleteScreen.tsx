"use client";

import { ResultsChart } from "@/components/ResultsChart";

interface Props {
  durations: number[];
  summaryMessage: string;
  personalBest: number;
  onFinish: () => void;
  onRestart: () => void;
}

export function SessionCompleteScreen({
  durations,
  summaryMessage,
  personalBest,
  onFinish,
  onRestart,
}: Props) {
  return (
    <div className="screen session-complete-screen">
      <h2>Session Complete!</h2>
      <p className="session-summary-message">{summaryMessage}</p>
      <ResultsChart durations={durations} />
      <div className="personal-best-display">
        All-time personal best: {Math.round(personalBest)}s
      </div>
      <div className="results-button-group">
        <button className="btn-primary" onClick={onFinish} autoFocus>
          Finish
        </button>
        <button className="btn-secondary" onClick={onRestart}>
          Do Another Session
        </button>
      </div>
    </div>
  );
}
