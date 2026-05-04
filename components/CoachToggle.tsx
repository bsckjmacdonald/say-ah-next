"use client";

interface Props {
  enabled: boolean;
  onToggle: (value: boolean) => void;
  /** Use the full card layout (WelcomeScreen). Default is compact inline. */
  variant?: "full" | "compact";
}

/**
 * Reusable coach toggle. `variant="full"` renders the card-style toggle from
 * WelcomeScreen; `variant="compact"` (default) renders a small inline version
 * for PreRepScreen and RepResultScreen.
 */
export function CoachToggle({ enabled, onToggle, variant = "compact" }: Props) {
  if (variant === "full") {
    return (
      <button
        className="coach-toggle-row"
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
      >
        <div className="coach-toggle-text">
          Voice coach
          <div className="coach-toggle-sub">
            {enabled
              ? "Speaks cues while you hold the sound"
              : "Silent — better loudness accuracy"}
          </div>
        </div>
        <div className={`toggle-pill${enabled ? " toggle-pill-on" : ""}`}>
          <div className="toggle-pill-thumb" />
        </div>
      </button>
    );
  }

  return (
    <button
      className="coach-toggle-compact"
      role="switch"
      aria-checked={enabled}
      onClick={() => onToggle(!enabled)}
    >
      <span className="coach-toggle-compact-label">
        Voice coach: <strong>{enabled ? "on" : "off"}</strong>
      </span>
      <div className={`toggle-pill toggle-pill-sm${enabled ? " toggle-pill-on" : ""}`}>
        <div className="toggle-pill-thumb toggle-pill-thumb-sm" />
      </div>
    </button>
  );
}
