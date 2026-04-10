"use client";

import { useState } from "react";

interface Props {
  onRequestMic: () => Promise<boolean>;
  onGranted: () => void;
}

export function MicPermissionScreen({ onRequestMic, onGranted }: Props) {
  const [denied, setDenied] = useState(false);

  const handleClick = async () => {
    const ok = await onRequestMic();
    if (ok) {
      onGranted();
    } else {
      setDenied(true);
    }
  };

  return (
    <div className="screen">
      <div className="content-wrapper" style={{ maxWidth: 560 }}>
        <div className="icon-container">
          <svg
            width="72"
            height="72"
            viewBox="0 0 72 72"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="36"
              cy="36"
              r="34"
              fill="rgba(42,124,124,0.1)"
              stroke="#2A7C7C"
              strokeWidth="2.5"
            />
            <rect x="28" y="14" width="16" height="26" rx="8" fill="#2A7C7C" />
            <path
              d="M20 36c0 8.84 7.16 16 16 16s16-7.16 16-16"
              stroke="#2A7C7C"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
            <line x1="36" y1="52" x2="36" y2="60" stroke="#2A7C7C" strokeWidth="3" strokeLinecap="round" />
            <line x1="28" y1="60" x2="44" y2="60" stroke="#2A7C7C" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <h2>One quick step</h2>
        <p className="instruction-text" style={{ fontSize: 24 }}>
          Say Ah uses your microphone to track your voice. Your browser will
          ask permission — here&apos;s what to do:
        </p>

        {/* Mock Safari permission dialog */}
        <div className="mic-safari-dialog">
          <div className="mic-safari-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 11c0 3.866 3.134 7 7 7s7-3.134 7-7" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="9" y1="22" x2="15" y2="22" />
            </svg>
            <span className="mic-safari-header-text">This file wants to</span>
            <div className="mic-safari-close">×</div>
          </div>
          <div className="mic-safari-request">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1c1c1e" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 11c0 3.866 3.134 7 7 7s7-3.134 7-7" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="9" y1="22" x2="15" y2="22" />
            </svg>
            <span className="mic-safari-request-text">
              Use available microphones (1)
            </span>
          </div>
          <div className="mic-safari-preview-card">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#636366" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 11c0 3.866 3.134 7 7 7s7-3.134 7-7" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="9" y1="22" x2="15" y2="22" />
            </svg>
            <div className="mic-safari-level-track">
              <div className="mic-safari-level-fill" />
            </div>
            <div className="mic-safari-dropdown-label">MacBook Air Mic ▾</div>
          </div>
          <div className="mic-safari-buttons">
            <div className="mic-safari-btn mic-safari-btn-primary">
              Allow while visiting the site
            </div>
            <div className="mic-safari-btn">Allow this time</div>
            <div className="mic-safari-btn">Never allow</div>
          </div>
        </div>
        <div className="mic-safari-annotation">↑ tap this one</div>

        <p
          className="instruction-text"
          style={{ fontSize: 22, color: "#5A6A6A", marginTop: 10 }}
        >
          A popup like this will appear on your screen. Tap{" "}
          <strong style={{ color: "#1c1c1e" }}>
            &quot;Allow while visiting the site&quot;
          </strong>{" "}
          — you&apos;ll only need to do this once.
        </p>
        <button
          className="btn-primary"
          onClick={handleClick}
          style={{
            marginTop: 32,
            background: denied ? "#E07B5A" : undefined,
          }}
        >
          {denied ? "Try again" : "OK, I'm ready"}
        </button>
        {denied && (
          <p className="mic-perm-error">
            It looks like microphone access was blocked. Please check your
            browser&apos;s site permissions and try again.
          </p>
        )}
      </div>
    </div>
  );
}
