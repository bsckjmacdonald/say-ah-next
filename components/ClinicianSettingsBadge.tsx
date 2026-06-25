"use client";

import { useEffect, useState } from "react";
import { clearClinicianSettings, loadSetupComplete } from "@/lib/storage";
import { coachVoice, DEFAULT_COACH_VOICE } from "@/lib/coachVoice";

/**
 * Top-left corner pill shown once the clinician has run /setup, mirroring the
 * top-right "View History" link. Includes a button to clear the clinician
 * settings (voice + coaching level) back to defaults. Reads the setup-complete
 * flag in an effect (not during render) so the server/client markup matches on
 * first paint — the badge appears after mount.
 */
export function ClinicianSettingsBadge() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(loadSetupComplete());
  }, []);

  if (!active) return null;

  const handleClear = () => {
    clearClinicianSettings();
    coachVoice.setVoice(DEFAULT_COACH_VOICE);
    setActive(false);
  };

  return (
    <div className="clinician-settings-badge">
      <span className="clinician-settings-badge-icon" aria-hidden="true">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="4" y1="8" x2="20" y2="8" />
          <circle cx="9" cy="8" r="2.6" fill="currentColor" stroke="none" />
          <line x1="4" y1="16" x2="20" y2="16" />
          <circle cx="15" cy="16" r="2.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className="clinician-settings-badge-label">Clinician settings active</span>
      <button
        type="button"
        className="clinician-settings-badge-clear"
        onClick={handleClear}
        aria-label="Clear clinician settings"
      >
        Clear
      </button>
    </div>
  );
}
