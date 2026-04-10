"use client";

// ============================================================================
// SAY AH — VOICE INPUT HOOK
//
// Uses the browser's built-in SpeechRecognition API so speech professionals
// can dictate feedback instead of typing. Feature-detected — the 🎤 button
// only renders on supported browsers (Chrome, Safari, Edge; not Firefox).
//
// The hook returns:
//   - `available` — true if SpeechRecognition exists in this browser
//   - `listening` — true while actively capturing speech
//   - `toggle()` — start/stop dictation
//   - `transcript` — the accumulated text (caller should sync this with
//     the textarea value)
//   - `resetTranscript()` — clear the accumulated text
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: Event & { error?: string }) => void) | null;
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor })
      .SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition ??
    null
  );
}

export interface UseVoiceInput {
  available: boolean;
  listening: boolean;
  toggle: () => void;
  transcript: string;
  resetTranscript: () => void;
}

export function useVoiceInput(): UseVoiceInput {
  const Ctor = getSpeechRecognition();
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  // Accumulated final text from previous recognition results. We append
  // new final transcripts to this base so dictation across multiple
  // toggle start/stop cycles accumulates correctly.
  const baseRef = useRef("");

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore.
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const toggle = useCallback(() => {
    if (!Ctor) return;

    if (recognitionRef.current) {
      // Stop
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setListening(false);
      // Save whatever we've accumulated so far as the new base for the
      // next toggle start.
      baseRef.current = transcript;
      return;
    }

    // Start
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += t;
        } else {
          interimText += t;
        }
      }
      if (finalText) {
        baseRef.current += (baseRef.current ? " " : "") + finalText.trim();
      }
      setTranscript(
        baseRef.current +
          (interimText ? (baseRef.current ? " " : "") + interimText : ""),
      );
    };

    rec.onend = () => {
      // Auto-stopped (silence timeout, error, etc.)
      recognitionRef.current = null;
      setListening(false);
      baseRef.current = transcript;
    };

    rec.onerror = (e) => {
      // "no-speech" is harmless — just means silence.
      if ((e as Event & { error?: string }).error !== "no-speech") {
        console.warn("SpeechRecognition error:", e);
      }
    };

    recognitionRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch (err) {
      console.warn("SpeechRecognition start failed:", err);
      recognitionRef.current = null;
      setListening(false);
    }
  }, [Ctor, transcript]);

  const resetTranscript = useCallback(() => {
    baseRef.current = "";
    setTranscript("");
  }, []);

  return {
    available: Ctor !== null,
    listening,
    toggle,
    transcript,
    resetTranscript,
  };
}
