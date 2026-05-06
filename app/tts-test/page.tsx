"use client";

import { useCallback, useRef, useState } from "react";

// ─── Config ──────────────────────────────────────────────────────────────────

const PHRASES = [
  "Good!",
  "Keep going!",
  "Push a little harder!",
  "Almost there!",
  "Strong finish!",
  "You're doing great!",
];

// Only use the highest-graded voices for the test.
const KOKORO_VOICES = [
  { id: "af_heart",  label: "Heart (warm female, A)"    },
  { id: "af_bella",  label: "Bella (energetic female, A-)" },
  { id: "bf_emma",   label: "Emma (British female, B-)" },
  { id: "am_michael", label: "Michael (calm male, C+)"  },
];

// Shuffle an array in place and return it.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type LoadState = "idle" | "loading-model" | "synthesizing" | "ready" | "error";

interface Clip {
  voiceId: string;      // kokoro voice id, or "web-speech"
  voiceLabel: string;   // human label, revealed at end
  phraseIndex: number;
  audioBuffer: AudioBuffer | null; // null = use Web Speech API
  blindLabel: string;   // "A" .. "E"
}

interface Rating {
  naturalness: number;  // 1–5, 0 = not rated
  warmth: number;       // 1–5, 0 = not rated
}

// Per phrase, the clips are presented in a shuffled blind order.
type PhraseRow = Clip[];

// ─── Stars component ─────────────────────────────────────────────────────────

function Stars({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <div style={{ display: "flex", gap: 2 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              color: n <= value ? "#f4a830" : "#ddd",
              padding: 0,
              margin: 0,
              lineHeight: 1,
              width: 24,
              height: 24,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label={`${n} star`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function TtsTestPage() {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadProgress, setLoadProgress] = useState<string>("");
  const [synthProgress, setSynthProgress] = useState(0);
  const [rows, setRows] = useState<PhraseRow[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  function getCtx() {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  const playClip = useCallback((clip: Clip, key: string) => {
    // Stop anything already playing
    try {
      sourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    sourceRef.current = null;

    if (clip.audioBuffer === null) {
      // Web Speech API fallback
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(PHRASES[clip.phraseIndex]);
      utter.onend = () => setPlaying(null);
      setPlaying(key);
      window.speechSynthesis.speak(utter);
      return;
    }

    const ctx = getCtx();
    const source = ctx.createBufferSource();
    source.buffer = clip.audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => setPlaying(null);
    source.start();
    sourceRef.current = source;
    setPlaying(key);
  }, []);

  const setRating = useCallback(
    (key: string, field: "naturalness" | "warmth", value: number) => {
      setRatings((prev) => ({
        ...prev,
        [key]: { ...{ naturalness: 0, warmth: 0 }, ...prev[key], [field]: value },
      }));
    },
    [],
  );

  const startTest = useCallback(async () => {
    setLoadState("loading-model");
    setLoadProgress("Downloading model (first load: ~82 MB, cached after)…");
    try {
      const { KokoroTTS } = await import("kokoro-js");
      const tts = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        {
          dtype: "q8",
          device: "wasm",
          progress_callback: (info: { status: string; name?: string; progress?: number }) => {
            if (info.status === "progress" && info.name && info.progress != null) {
              setLoadProgress(
                `Downloading ${info.name.split("/").at(-1)} — ${Math.round(info.progress)}%`,
              );
            } else if (info.status === "done") {
              setLoadProgress("Model ready, synthesizing clips…");
            }
          },
        },
      );

      setLoadState("synthesizing");
      const ctx = getCtx();

      // Build all clips: 4 Kokoro voices + 1 Web Speech, per phrase.
      const allRows: PhraseRow[] = [];
      let done = 0;
      const total = PHRASES.length * KOKORO_VOICES.length;

      for (let pi = 0; pi < PHRASES.length; pi++) {
        const voiceSlots: Clip[] = [];

        // Kokoro voices
        for (const v of KOKORO_VOICES) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await tts.generate(PHRASES[pi], { voice: v.id as any });
          // Convert RawAudio (Float32Array, 24 kHz) → AudioBuffer
          const samples = new Float32Array(result.audio);
          const buf = ctx.createBuffer(1, samples.length, 24000);
          buf.copyToChannel(samples, 0);
          voiceSlots.push({
            voiceId: v.id,
            voiceLabel: v.label,
            phraseIndex: pi,
            audioBuffer: buf,
            blindLabel: "",
          });
          done++;
          setSynthProgress(Math.round((done / total) * 100));
        }

        // Web Speech API (no pre-synthesis — plays live)
        voiceSlots.push({
          voiceId: "web-speech",
          voiceLabel: "Browser built-in (Web Speech API)",
          phraseIndex: pi,
          audioBuffer: null,
          blindLabel: "",
        });

        // Shuffle and assign blind labels A–E
        shuffle(voiceSlots);
        voiceSlots.forEach((c, i) => {
          c.blindLabel = String.fromCharCode(65 + i); // A, B, C, D, E
        });
        allRows.push(voiceSlots);
      }

      setRows(allRows);
      setLoadState("ready");
    } catch (err) {
      console.error(err);
      setErrorMsg(String(err));
      setLoadState("error");
    }
  }, []);

  const exportResults = useCallback(() => {
    const output = rows.map((row, pi) => ({
      phrase: PHRASES[pi],
      clips: row.map((clip) => ({
        blindLabel: clip.blindLabel,
        voiceId: revealed ? clip.voiceId : "(hidden)",
        voiceLabel: revealed ? clip.voiceLabel : "(hidden)",
        ratings: ratings[`${pi}-${clip.blindLabel}`] ?? { naturalness: 0, warmth: 0 },
      })),
    }));
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tts-ratings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, ratings, revealed]);

  const ratedCount = Object.values(ratings).filter(
    (r) => r.naturalness > 0 && r.warmth > 0,
  ).length;
  const totalClips = PHRASES.length * 5;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadState === "idle") {
    return (
      <div style={styles.page}>
        <h1 style={styles.h1}>TTS Voice Comparison</h1>
        <p style={styles.intro}>
          This page loads the Kokoro TTS model and synthesizes 6 coaching phrases
          in 4 voices, plus the browser&apos;s built-in voice as a baseline.
          Voices are labelled A–E per phrase — the mapping is hidden until you
          click Reveal.
        </p>
        <p style={styles.intro}>
          First load downloads ~82 MB (cached after). Takes 30–90 seconds to
          synthesize all clips.
        </p>
        <button style={styles.btnPrimary} onClick={startTest}>
          Load &amp; Synthesize All Clips
        </button>
      </div>
    );
  }

  if (loadState === "loading-model" || loadState === "synthesizing") {
    return (
      <div style={styles.page}>
        <h1 style={styles.h1}>TTS Voice Comparison</h1>
        <p style={{ color: "#555", marginBottom: 12 }}>{loadProgress}</p>
        {loadState === "synthesizing" && (
          <>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressBar, width: `${synthProgress}%` }} />
            </div>
            <p style={{ color: "#888", fontSize: 14, marginTop: 8 }}>
              Synthesizing clips: {synthProgress}%
            </p>
          </>
        )}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div style={styles.page}>
        <h1 style={styles.h1}>Error</h1>
        <p style={{ color: "#c00" }}>{errorMsg}</p>
        <button style={styles.btnPrimary} onClick={() => setLoadState("idle")}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>TTS Voice Comparison</h1>
      <p style={styles.intro}>
        For each phrase, play each voice and rate it. Voices are labelled A–E
        (random order per phrase). Rate before revealing to keep the test fair.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <button
          style={styles.btnSecondary}
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? "Hide Voice Labels" : "Reveal Voice Labels"}
        </button>
        <button style={styles.btnPrimary} onClick={exportResults}>
          Export Results JSON ({ratedCount}/{totalClips} rated)
        </button>
      </div>

      {rows.map((row, pi) => (
        <div key={pi} style={styles.phraseBlock}>
          <h2 style={styles.phraseHeading}>
            Phrase {pi + 1}: &ldquo;{PHRASES[pi]}&rdquo;
          </h2>
          <div style={styles.clipGrid}>
            {row.map((clip) => {
              const key = `${pi}-${clip.blindLabel}`;
              const r = ratings[key] ?? { naturalness: 0, warmth: 0 };
              const isPlaying = playing === key;
              return (
                <div key={clip.blindLabel} style={styles.clipCard}>
                  <div style={styles.clipHeader}>
                    <span style={styles.blindLabel}>Voice {clip.blindLabel}</span>
                    {revealed && (
                      <span style={styles.revealedLabel}>{clip.voiceLabel}</span>
                    )}
                  </div>
                  <button
                    style={isPlaying ? styles.btnPlayActive : styles.btnPlay}
                    onClick={() => playClip(clip, key)}
                  >
                    {isPlaying ? "▶ Playing…" : "▶ Play"}
                  </button>
                  <Stars
                    label="Natural"
                    value={r.naturalness}
                    onChange={(v) => setRating(key, "naturalness", v)}
                  />
                  <Stars
                    label="Warm"
                    value={r.warmth}
                    onChange={(v) => setRating(key, "warmth", v)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 32, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          style={styles.btnSecondary}
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? "Hide Voice Labels" : "Reveal Voice Labels"}
        </button>
        <button style={styles.btnPrimary} onClick={exportResults}>
          Export Results JSON ({ratedCount}/{totalClips} rated)
        </button>
      </div>
    </div>
  );
}

// ─── Inline styles (test page only — no shared CSS needed) ───────────────────

const styles = {
  page: {
    maxWidth: 900,
    margin: "0 auto",
    padding: "32px 20px 64px",
    fontFamily: "system-ui, sans-serif",
    color: "#222",
  } as React.CSSProperties,
  h1: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 12,
  } as React.CSSProperties,
  intro: {
    fontSize: 15,
    color: "#555",
    marginBottom: 16,
    lineHeight: 1.5,
  } as React.CSSProperties,
  progressTrack: {
    height: 10,
    background: "#e0e0e0",
    borderRadius: 5,
    overflow: "hidden",
    maxWidth: 400,
  } as React.CSSProperties,
  progressBar: {
    height: "100%",
    background: "#2a7c7c",
    transition: "width 0.3s ease",
  } as React.CSSProperties,
  btnPrimary: {
    background: "#2a7c7c",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    fontSize: 15,
    cursor: "pointer",
    fontWeight: 600,
  } as React.CSSProperties,
  btnSecondary: {
    background: "#f0f0f0",
    color: "#333",
    border: "1px solid #ccc",
    borderRadius: 8,
    padding: "10px 20px",
    fontSize: 15,
    cursor: "pointer",
  } as React.CSSProperties,
  phraseBlock: {
    marginBottom: 32,
    borderTop: "1px solid #e0e0e0",
    paddingTop: 20,
  } as React.CSSProperties,
  phraseHeading: {
    fontSize: 17,
    fontWeight: 600,
    marginBottom: 14,
  } as React.CSSProperties,
  clipGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 12,
  } as React.CSSProperties,
  clipCard: {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "12px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "#fafafa",
  } as React.CSSProperties,
  clipHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } as React.CSSProperties,
  blindLabel: {
    fontWeight: 700,
    fontSize: 15,
  } as React.CSSProperties,
  revealedLabel: {
    fontSize: 11,
    color: "#777",
  } as React.CSSProperties,
  btnPlay: {
    background: "#e8f4f4",
    color: "#2a7c7c",
    border: "1px solid #b0d4d4",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  } as React.CSSProperties,
  btnPlayActive: {
    background: "#2a7c7c",
    color: "#fff",
    border: "1px solid #2a7c7c",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  } as React.CSSProperties,
};
