"use client";

import { useEffect, useState } from "react";
import { TOTAL_REPS } from "@/lib/constants";
import { loadSpeakCoachCues, saveSpeakCoachCues } from "@/lib/storage";

interface Props {
  userName: string;
  onUserNameChange: (name: string) => void;
  onBegin: () => void;
  onShowHistory: () => void;
}

export function WelcomeScreen({
  userName,
  onUserNameChange,
  onBegin,
  onShowHistory,
}: Props) {
  // Persisted opt-in for in-rep TTS coach cues. The on-screen text always
  // shows; this toggle controls only whether the cue is also spoken.
  // Hydrate from localStorage after mount — same pattern useSession uses for
  // its persisted state (reading storage during render would SSR-mismatch).
  const [speakCoachCues, setSpeakCoachCues] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeakCoachCues(loadSpeakCoachCues());
  }, []);

  const handleSpeakCoachCuesChange = (value: boolean) => {
    setSpeakCoachCues(value);
    saveSpeakCoachCues(value);
  };
  return (
    <div className="screen welcome-screen">
      <button
        type="button"
        className="welcome-history-corner-link"
        onClick={onShowHistory}
      >
        View History
      </button>
      <div className="welcome-content">
        <div className="icon-container">
          <svg
            width="84"
            height="84"
            viewBox="0 0 120 120"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="60" cy="60" r="50" fill="none" stroke="#2A7C7C" strokeWidth="3" />
            <path
              d="M 35 65 Q 60 85 85 65"
              stroke="#E07B5A"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 95 50 Q 100 55 95 60"
              stroke="#2A7C7C"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 103 44 Q 113 55 103 66"
              stroke="#2A7C7C"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h1>Say Ah</h1>
        <p className="subtitle">Voice Exercise</p>
        <p className="instruction-text welcome-instruction">
          Today you&apos;ll do {TOTAL_REPS} voice rounds.
          <br />
          Take your time with each one.
        </p>
        <div className="name-input-wrapper">
          <label htmlFor="user-name-input" className="name-label">
            Your first name (optional)
          </label>
          <input
            type="text"
            id="user-name-input"
            className="name-input"
            placeholder="e.g. Margaret"
            maxLength={30}
            autoComplete="given-name"
            autoCapitalize="words"
            spellCheck={false}
            value={userName}
            onChange={(e) => onUserNameChange(e.target.value)}
          />
        </div>
        <div className="welcome-toggle-row">
          <input
            type="checkbox"
            id="speak-coach-cues-toggle"
            className="welcome-toggle-checkbox"
            checked={speakCoachCues}
            onChange={(e) => handleSpeakCoachCuesChange(e.target.checked)}
          />
          <label
            htmlFor="speak-coach-cues-toggle"
            className="welcome-toggle-label"
          >
            Speak coach cues during rounds
          </label>
        </div>
        <div className="button-group">
          <button className="btn-primary" onClick={onBegin}>
            Let&apos;s Begin
          </button>
        </div>
      </div>
    </div>
  );
}
