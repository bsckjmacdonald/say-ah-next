// ResultsChart — final per-rep horizontal bar chart shown on the
// session-complete screen. Direct port of buildResultsChart() from the
// prototype.

import { TARGET_DURATION_SECONDS } from "@/lib/constants";

export function ResultsChart({ durations }: { durations: number[] }) {
  if (durations.length === 0) return null;

  const maxDur = Math.max(...durations, TARGET_DURATION_SECONDS * 1.1);
  const targetPct = (TARGET_DURATION_SECONDS / maxDur) * 100;

  return (
    <div className="results-chart">
      <div className="results-chart-title">Results by Round</div>
      {durations.map((dur, i) => {
        const pct = (dur / maxDur) * 100;
        return (
          <div key={i} className="chart-row">
            <div className="chart-label">Round {i + 1}</div>
            <div className="chart-bar-container">
              <div
                className="target-line"
                style={{ left: `${targetPct}%` }}
              />
              <div className="chart-bar" style={{ width: `${pct}%` }}>
                {pct > 15 && (
                  <span className="chart-bar-value">{Math.round(dur)}s</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div className="results-chart-legend">
        <span className="results-chart-legend-swatch" />
        Target: {TARGET_DURATION_SECONDS}s
      </div>
    </div>
  );
}
