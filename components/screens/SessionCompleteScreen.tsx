"use client";

import { ResultsChart } from "@/components/ResultsChart";
import { ClinicianSettingsBadge } from "@/components/ClinicianSettingsBadge";
import { formatMinutesSeconds } from "@/lib/format";

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
  const totalSpeakingTime = durations.reduce((a, b) => a + b, 0);
  return (
    <div className="screen session-complete-screen">
      <ClinicianSettingsBadge />
      <h2>Session Complete!</h2>
      <p className="session-summary-message">{summaryMessage}</p>
      <ResultsChart durations={durations} />
      <div className="total-speaking-time-display">
        Total speaking time: {formatMinutesSeconds(totalSpeakingTime)}
      </div>
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
