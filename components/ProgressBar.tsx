// ProgressBar — top-of-screen percent indicator. No client-only behaviour.
import { TOTAL_REPS } from "@/lib/constants";

export function ProgressBar({ currentRep }: { currentRep: number }) {
  const pct = (currentRep / TOTAL_REPS) * 100;
  return (
    <div className="progress-bar-container">
      <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
