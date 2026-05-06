"use client";

import { useCallback, useRef, useState } from "react";

const PHRASES = [
  "Good!",
  "Keep going!",
  "Push a little harder!",
  "Almost there!",
  "Strong finish!",
  "You're doing great!",
];

const KOKORO_VOICES = [
  { id: "af_heart",   label: "Heart — warm female (grade A)" },
  { id: "af_bella",   label: "Bella — energetic female (grade A−)" },
  { id: "bf_emma",    label: "Emma — British female (grade B−)" },
  { id: "am_michael", label: "Michael — calm male (grade C+)" },
];

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type LoadState = "idle" | "loading" | "synthesizing" | "ready" | "error";

interface Clip {
  voiceId: string;
  voiceLabel: string;
  phraseIndex: number;
  audioBuffer: AudioBuffer | null;
  blindLabel: string; // A–E
}

interface Rating { naturalness: number; warmth: number; }

// ── Star scale ────────────────────────────────────────────────────────────────
// Vertical stack: row n shows n stars. Click any row to select that rating.
function StarScale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 80 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 4, textAlign: "center" }}>
        {label}
      </span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${label} ${n} star${n !== 1 ? "s" : ""}`}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "3px 6px",
            marginBottom: 2,
            border: `1px solid ${n === value ? "#f59e0b" : "transparent"}`,
            borderRadius: 4,
            cursor: "pointer",
            background: n === value ? "#fef3c7" : "transparent",
            gap: 1,
          }}
        >
          {Array.from({ length: n }, (_, i) => (
            <span key={i} style={{ fontSize: 14, color: "#f59e0b", lineHeight: 1 }}>★</span>
          ))}
        </button>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TtsTestPage() {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadProgress, setLoadProgress] = useState("");
  const [synthProgress, setSynthProgress] = useState(0);
  const [rows, setRows] = useState<Clip[][]>([]);
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
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  const play = useCallback((clip: Clip, key: string) => {
    try { sourceRef.current?.stop(); } catch { /* already stopped */ }
    sourceRef.current = null;

    if (!clip.audioBuffer) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(PHRASES[clip.phraseIndex]);
      u.onend = () => setPlaying(null);
      setPlaying(key);
      window.speechSynthesis.speak(u);
      return;
    }

    const ctx = getCtx();
    const src = ctx.createBufferSource();
    src.buffer = clip.audioBuffer;
    src.connect(ctx.destination);
    src.onended = () => setPlaying(null);
    src.start();
    sourceRef.current = src;
    setPlaying(key);
  }, []);

  const rate = useCallback((key: string, field: keyof Rating, value: number) => {
    setRatings((prev) => ({
      ...prev,
      [key]: { ...{ naturalness: 0, warmth: 0 }, ...prev[key], [field]: value },
    }));
  }, []);

  const startTest = useCallback(async () => {
    setLoadState("loading");
    setLoadProgress("Downloading model (~82 MB, cached after first load)…");
    try {
      const { KokoroTTS } = await import("kokoro-js");
      const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "wasm",
        progress_callback: (info: { status: string; name?: string; progress?: number }) => {
          if (info.status === "progress" && info.name && info.progress != null) {
            setLoadProgress(`Downloading ${info.name.split("/").at(-1)} — ${Math.round(info.progress)}%`);
          } else if (info.status === "done") {
            setLoadProgress("Model ready — synthesizing clips…");
          }
        },
      });

      setLoadState("synthesizing");
      const ctx = getCtx();
      const allRows: Clip[][] = [];
      let done = 0;
      const total = PHRASES.length * KOKORO_VOICES.length;

      for (let pi = 0; pi < PHRASES.length; pi++) {
        const slots: Clip[] = [];
        for (const v of KOKORO_VOICES) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await tts.generate(PHRASES[pi], { voice: v.id as any });
          const samples = new Float32Array(result.audio);
          const buf = ctx.createBuffer(1, samples.length, 24000);
          buf.copyToChannel(samples, 0);
          slots.push({ voiceId: v.id, voiceLabel: v.label, phraseIndex: pi, audioBuffer: buf, blindLabel: "" });
          done++;
          setSynthProgress(Math.round((done / total) * 100));
        }
        // Add Web Speech baseline
        slots.push({ voiceId: "web-speech", voiceLabel: "Browser built-in (Web Speech API)", phraseIndex: pi, audioBuffer: null, blindLabel: "" });
        shuffle(slots);
        slots.forEach((c, i) => { c.blindLabel = String.fromCharCode(65 + i); });
        allRows.push(slots);
      }

      setRows(allRows);
      setLoadState("ready");
    } catch (err) {
      setErrorMsg(String(err));
      setLoadState("error");
    }
  }, []);

  const exportJson = useCallback(() => {
    const data = rows.map((row, pi) => ({
      phrase: PHRASES[pi],
      clips: row.map((clip) => ({
        blindLabel: clip.blindLabel,
        voice: revealed ? clip.voiceLabel : "(hidden until reveal)",
        ratings: ratings[`${pi}-${clip.blindLabel}`] ?? { naturalness: 0, warmth: 0 },
      })),
    }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `tts-ratings-${new Date().toISOString().slice(0, 10)}.json` }).click();
    URL.revokeObjectURL(url);
  }, [rows, ratings, revealed]);

  const ratedCount = Object.values(ratings).filter((r) => r.naturalness > 0 && r.warmth > 0).length;

  // ── Loading / error states ────────────────────────────────────────────────

  if (loadState === "idle") {
    return (
      <main style={s.main}>
        <h1 style={s.h1}>TTS Voice Comparison</h1>
        <p style={s.body}>
          Loads the Kokoro TTS model and synthesizes 6 coaching phrases across
          4 voices, plus the browser&apos;s built-in voice as a baseline.
          Voices are randomised and labelled A–E so the test is blind.
        </p>
        <p style={s.body}>
          First load downloads ~82 MB (cached after). Synthesis takes 30–90 s.
        </p>
        <button style={s.btnPrimary} onClick={startTest}>
          Load &amp; Synthesize All Clips
        </button>
      </main>
    );
  }

  if (loadState === "loading" || loadState === "synthesizing") {
    return (
      <main style={s.main}>
        <h1 style={s.h1}>TTS Voice Comparison</h1>
        <p style={s.body}>{loadProgress}</p>
        {loadState === "synthesizing" && (
          <div style={{ marginTop: 16 }}>
            <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4, maxWidth: 360, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${synthProgress}%`, background: "#2a7c7c", transition: "width 0.3s" }} />
            </div>
            <p style={{ fontSize: 13, color: "#888", marginTop: 8 }}>
              {synthProgress}% — synthesizing clips…
            </p>
          </div>
        )}
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main style={s.main}>
        <h1 style={s.h1}>Error</h1>
        <pre style={{ color: "#b91c1c", whiteSpace: "pre-wrap", fontSize: 13 }}>{errorMsg}</pre>
        <button style={s.btnPrimary} onClick={() => setLoadState("idle")}>Try Again</button>
      </main>
    );
  }

  // ── Ready: full rating UI ─────────────────────────────────────────────────

  return (
    <main style={s.main}>
      <h1 style={s.h1}>TTS Voice Comparison</h1>
      <p style={s.body}>
        Play each voice and rate it before revealing the labels. Voices are
        randomised independently for each phrase.
      </p>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 32 }}>
        <button style={s.btnSecondary} onClick={() => setRevealed((r) => !r)}>
          {revealed ? "Hide Labels" : "Reveal Voice Labels"}
        </button>
        <button style={s.btnPrimary} onClick={exportJson}>
          Export JSON ({ratedCount}/{PHRASES.length * 5} rated)
        </button>
      </div>

      {/* Phrase sections */}
      {rows.map((row, pi) => (
        <section key={pi} style={s.phraseSection}>
          <h2 style={s.phraseHeading}>
            Phrase {pi + 1} of {PHRASES.length}: &ldquo;{PHRASES[pi]}&rdquo;
          </h2>

          {/* Voice rows — one per voice, full width */}
          {row.map((clip) => {
            const key = `${pi}-${clip.blindLabel}`;
            const r = ratings[key] ?? { naturalness: 0, warmth: 0 };
            const isPlaying = playing === key;
            const rated = r.naturalness > 0 && r.warmth > 0;

            return (
              <div key={clip.blindLabel} style={{ ...s.voiceRow, borderLeft: rated ? "3px solid #2a7c7c" : "3px solid #e5e7eb" }}>
                {/* Left: label + play */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <span style={s.blindLabel}>Voice {clip.blindLabel}</span>
                  <button
                    style={isPlaying ? s.btnPlayOn : s.btnPlay}
                    onClick={() => play(clip, key)}
                  >
                    {isPlaying ? "▶ Playing…" : "▶ Play"}
                  </button>
                  {revealed && (
                    <span style={s.revealTag}>{clip.voiceLabel}</span>
                  )}
                </div>

                {/* Right: star scales */}
                <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                  <StarScale label="Natural" value={r.naturalness} onChange={(v) => rate(key, "naturalness", v)} />
                  <StarScale label="Warm"    value={r.warmth}       onChange={(v) => rate(key, "warmth", v)} />
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {/* Bottom controls */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16, paddingBottom: 64 }}>
        <button style={s.btnSecondary} onClick={() => setRevealed((r) => !r)}>
          {revealed ? "Hide Labels" : "Reveal Voice Labels"}
        </button>
        <button style={s.btnPrimary} onClick={exportJson}>
          Export JSON ({ratedCount}/{PHRASES.length * 5} rated)
        </button>
      </div>
    </main>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "32px 20px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#111",
  },
  h1: { fontSize: 22, fontWeight: 700, marginBottom: 12 },
  body: { fontSize: 15, color: "#555", marginBottom: 12, lineHeight: 1.5 },
  btnPrimary: {
    background: "#2a7c7c", color: "#fff", border: "none",
    borderRadius: 8, padding: "10px 18px", fontSize: 14,
    cursor: "pointer", fontWeight: 600,
  },
  btnSecondary: {
    background: "#f3f4f6", color: "#333", border: "1px solid #d1d5db",
    borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer",
  },
  phraseSection: {
    marginBottom: 40,
    paddingTop: 24,
    borderTop: "2px solid #e5e7eb",
  },
  phraseHeading: { fontSize: 16, fontWeight: 600, marginBottom: 12, color: "#333" },
  voiceRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    marginBottom: 8,
    background: "#fafafa",
    borderRadius: 8,
    borderLeft: "3px solid #e5e7eb",
  },
  blindLabel: { fontWeight: 700, fontSize: 15, minWidth: 64, flexShrink: 0 },
  btnPlay: {
    background: "#e0f2f2", color: "#2a7c7c",
    border: "1px solid #a7d4d4", borderRadius: 6,
    padding: "7px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600,
    whiteSpace: "nowrap",
  },
  btnPlayOn: {
    background: "#2a7c7c", color: "#fff",
    border: "1px solid #2a7c7c", borderRadius: 6,
    padding: "7px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600,
    whiteSpace: "nowrap",
  },
  revealTag: {
    fontSize: 12, color: "#6b7280", fontStyle: "italic",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
};
