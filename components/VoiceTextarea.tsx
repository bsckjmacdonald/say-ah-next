"use client";

// Textarea with an optional 🎤 dictation toggle. Uses the browser's
// SpeechRecognition API when available; falls back to a plain textarea
// (no mic button) on unsupported browsers.

import { useEffect } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";

interface Props {
  id: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}

export function VoiceTextarea({
  id,
  placeholder,
  value,
  onChange,
  rows = 3,
}: Props) {
  const voice = useVoiceInput();

  // Sync voice transcript → parent value while dictating.
  useEffect(() => {
    if (voice.listening && voice.transcript) {
      onChange(voice.transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript]);

  return (
    <div className="voice-textarea-wrapper">
      <textarea
        id={id}
        className="feedback-textarea"
        placeholder={placeholder}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // If user types while we have voice transcript, reset voice base
          // so subsequent dictation appends to the typed text.
          if (voice.transcript) voice.resetTranscript();
        }}
      />
      {voice.available && (
        <button
          type="button"
          className={`voice-btn ${voice.listening ? "voice-btn-active" : ""}`}
          onClick={voice.toggle}
          aria-label={voice.listening ? "Stop dictation" : "Dictate with microphone"}
          title={voice.listening ? "Stop dictation" : "Dictate"}
        >
          {voice.listening ? (
            // Pulsing red indicator
            <span className="voice-pulse" />
          ) : (
            // Mic icon
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 11c0 3.866 3.134 7 7 7s7-3.134 7-7" />
              <line x1="12" y1="18" x2="12" y2="22" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
