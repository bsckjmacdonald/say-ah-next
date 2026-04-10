"use client";

import type { SessionRecord } from "@/lib/types";

interface Props {
  history: SessionRecord[];
  onBack: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function HistoryScreen({ history, onBack }: Props) {
  return (
    <div className="screen history-screen">
      <h2>Your Progress</h2>
      <ul className="history-list">
        {history.length === 0 ? (
          <li className="history-empty">
            No sessions yet — start your first one!
          </li>
        ) : (
          // Newest first
          [...history].reverse().map((s, i) => (
            <li key={s.date + i}>
              <div className="history-item">
                <div className="history-item-date">{formatDate(s.date)}</div>
                <div className="history-item-stat">
                  Average: {Math.round(s.average)}s &nbsp;|&nbsp; Best:{" "}
                  {Math.round(s.best)}s
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
      <button
        className="btn-primary btn-small"
        onClick={onBack}
        style={{ marginTop: 20, marginBottom: 40 }}
        autoFocus
      >
        Back
      </button>
    </div>
  );
}
