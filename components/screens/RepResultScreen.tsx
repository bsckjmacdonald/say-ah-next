"use client";

import { useEffect, useRef, useState } from "react";
import { TOTAL_REPS } from "@/lib/constants";
import { ProgressBar } from "@/components/ProgressBar";
import { FinalStripChart } from "@/components/StripChart";
import { formatSeconds } from "@/lib/format";
import { cancelSpeech } from "@/lib/tts";
import { RepRating } from "@/components/RepRating";
import type { RepResult } from "@/hooks/useSession";

interface Props {
  result: RepResult;
  onNext: () => void;
  onSeeResults: () => void;
}

export function RepResultScreen({ result, onNext, onSeeResults }: Props) {
  const isLast = result.repNumber >= TOTAL_REPS;

  // ── Playback ──────────────────────────────────────────────────────────
  // Lets the patient hear their own voice — central to LSVT's "calibration"
  // principle (people with PD systematically perceive themselves as louder
  // than they actually are; hearing the recording closes that gap).
  //
  // We use a plain <audio> element rather than Web Audio API processing —
  // we tried muting the windows where the coach was speaking but the gaps
  // felt jarring. The browser's built-in echo cancellation already
  // suppresses most of the coach bleed; the small amount that remains
  // preserves continuity, which user testing showed mattered more.
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!result.audioUrl) return;
    const audio = new Audio(result.audioUrl);
    audio.onended = () => setIsPlaying(false);
    audio.onpause = () => setIsPlaying(false);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [result.audioUrl]);

  const handlePlayback = () => {
    if (!audioRef.current) return;
    cancelSpeech();
    audioRef.current.currentTime = 0;
    audioRef.current.play().then(
      () => setIsPlaying(true),
      (err) => console.warn("Playback failed:", err),
    );
  };

  return (
    <div className="screen" style={{ gap: 16 }}>
      <ProgressBar currentRep={result.repNumber} />
      <div className="content-wrapper">
        <div className="result-rep-number">
          Round {result.repNumber} of {TOTAL_REPS}
        </div>
        <div className="result-duration">
          You held it for {formatSeconds(result.duration)}!
        </div>

        {result.audioUrl && (
          <button
            type="button"
            className="btn-playback"
            onClick={handlePlayback}
            aria-label="Play back your voice recording"
          >
            {isPlaying ? (
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            <span>{isPlaying ? "Playing…" : "Hear your voice"}</span>
          </button>
        )}

        <FinalStripChart buffer={result.stripBuffer} />
        <div className="result-message">{result.feedback.display}</div>
        <RepRating
          repNumber={result.repNumber}
          category={result.category}
          duration={result.duration}
        />
        <button
          className="btn-primary"
          onClick={isLast ? onSeeResults : onNext}
          style={{ marginTop: 40 }}
          autoFocus
        >
          {isLast ? "See My Results" : "Next Round"}
        </button>
      </div>
    </div>
  );
}
