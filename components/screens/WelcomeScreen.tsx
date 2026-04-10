"use client";

import { TOTAL_REPS } from "@/lib/constants";

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
  return (
    <div className="screen">
      <div className="welcome-content">
        <div className="icon-container">
          <svg
            width="120"
            height="120"
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
        <p className="instruction-text" style={{ marginTop: 40 }}>
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
        <div className="button-group">
          <button className="btn-primary" onClick={onBegin}>
            Let&apos;s Begin
          </button>
          <button className="link-button" onClick={onShowHistory}>
            View History
          </button>
        </div>
      </div>
    </div>
  );
}
