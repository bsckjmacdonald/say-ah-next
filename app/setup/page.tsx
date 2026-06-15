"use client";

// ============================================================================
// SAY AH — CLINICIAN SETUP  (/setup)
//
// A clinician-run, one-time-per-device configuration flow (see
// CLINICIAN-SETUP-REVIEW.md). NOT linked from the patient app — the clinician
// opens it during a remote session. Three steps:
//
//   1. Mic calibration — the patient sustains "ahh"; the clinician judges the
//      loudness and sets it on a slider. That sets the per-device dB SPL offset
//      AND the patient's green-zone baseline (floor). No bottle-whistle
//      required — the clinician's ear is the reference.
//   2. Coach voice — pick a Kokoro voice from the graded shortlist.
//   3. Coaching level — minimal / standard / encouraging.
//
// Everything persists to localStorage (per device); the patient app reads it
// with safe fallback defaults so it still works if setup never ran.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buildAWeightingCoefficients } from "@/lib/aWeighting";
import { rmsToDbFs, setActiveCalibrationOffset } from "@/lib/audio";
import { TARGET_FLOOR_DEFAULT_DB } from "@/lib/constants";
import {
  COACH_VOICES,
  DEFAULT_COACH_VOICE,
  coachVoice,
  type CoachVoiceId,
} from "@/lib/coachVoice";
import {
  saveCoachVoice,
  saveCoachingLevel,
  saveDeviceBaseline,
  saveDeviceOffset,
  saveSetupComplete,
  type CoachingLevel,
} from "@/lib/storage";

type Step = "welcome" | "calibrate" | "voice" | "verbosity" | "done";

// Mirror the exercise RMS computation (same *2 scaling) so the calibrated
// offset matches what the meter will show during a real rep.
function computeRMS(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.min(1, Math.sqrt(sum / data.length) * 2);
}

const CAPTURE_SECONDS = 5;
const SIGNAL_FLOOR_RMS = 0.005; // ignore near-silence frames in the mean

/**
 * Capture the mean A-weighted RMS of a sustained phonation, through the same
 * audio path the exercise uses. Returns the mean and the device id.
 */
async function captureMeanLevel(
  onTick: (elapsed: number) => void,
): Promise<{ meanRms: number; deviceId: string | null }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
  });
  const track = stream.getAudioTracks()[0];
  const deviceId = track.getSettings().deviceId ?? null;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state !== "running") await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const { feedforward, feedback } = buildAWeightingCoefficients(ctx.sampleRate);
  const filter = ctx.createIIRFilter(feedforward, feedback);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(filter);
  filter.connect(analyser);
  const data = new Float32Array(analyser.fftSize);

  return new Promise((resolve) => {
    let sum = 0;
    let count = 0;
    const start = performance.now();
    const loop = () => {
      analyser.getFloatTimeDomainData(data);
      const rms = computeRMS(data);
      if (rms > SIGNAL_FLOOR_RMS) {
        sum += rms;
        count++;
      }
      const elapsed = (performance.now() - start) / 1000;
      onTick(elapsed);
      if (elapsed >= CAPTURE_SECONDS) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        resolve({ meanRms: count > 0 ? sum / count : 0, deviceId });
      } else {
        requestAnimationFrame(loop);
      }
    };
    requestAnimationFrame(loop);
  });
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>("welcome");

  // Start downloading the Kokoro model immediately (in the worker) so it's
  // ready by the time the clinician reaches the voice step, instead of a ~30 s
  // wait there.
  useEffect(() => {
    void coachVoice.load();
  }, []);

  return (
    <main style={s.main}>
      <header style={s.header}>
        <h1 style={s.h1}>Clinician Setup</h1>
        {step !== "welcome" && step !== "done" && (
          <span style={s.stepTag}>
            {step === "calibrate"
              ? "Step 1 of 3"
              : step === "voice"
                ? "Step 2 of 3"
                : "Step 3 of 3"}
          </span>
        )}
      </header>

      {step === "welcome" && <Welcome onBegin={() => setStep("calibrate")} />}
      {step === "calibrate" && (
        <CalibrateStep onDone={() => setStep("voice")} />
      )}
      {step === "voice" && <VoiceStep onDone={() => setStep("verbosity")} />}
      {step === "verbosity" && (
        <VerbosityStep onDone={() => setStep("done")} />
      )}
      {step === "done" && <DoneStep />}
    </main>
  );
}

// ── Welcome ─────────────────────────────────────────────────────────────────
function Welcome({ onBegin }: { onBegin: () => void }) {
  return (
    <section>
      <p style={s.body}>
        This takes about two minutes. Your clinician will guide you through each
        step. The patient app is not changed by this — it just remembers these
        settings on this device.
      </p>
      <button style={s.btnPrimary} onClick={onBegin}>
        Begin Setup
      </button>
    </section>
  );
}

// ── Step 1: calibration ───────────────────────────────────────────────────
function CalibrateStep({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"idle" | "capturing" | "measured">("idle");
  const [countdown, setCountdown] = useState(CAPTURE_SECONDS);
  const [perceivedDb, setPerceivedDb] = useState(TARGET_FLOOR_DEFAULT_DB);
  const [error, setError] = useState("");
  const measuredRef = useRef<{ meanDbFs: number; deviceId: string | null }>({
    meanDbFs: 0,
    deviceId: null,
  });

  const start = useCallback(async () => {
    setError("");
    setPhase("capturing");
    setCountdown(CAPTURE_SECONDS);
    try {
      const { meanRms, deviceId } = await captureMeanLevel((elapsed) => {
        setCountdown(Math.max(0, Math.ceil(CAPTURE_SECONDS - elapsed)));
      });
      if (meanRms < SIGNAL_FLOOR_RMS) {
        setError("No voice detected — make sure the patient is speaking, then try again.");
        setPhase("idle");
        return;
      }
      measuredRef.current = { meanDbFs: rmsToDbFs(meanRms), deviceId };
      setPhase("measured");
    } catch (err) {
      console.error("Calibration capture failed:", err);
      setError("Could not access the microphone. Check permissions and try again.");
      setPhase("idle");
    }
  }, []);

  const accept = useCallback(() => {
    const { meanDbFs, deviceId } = measuredRef.current;
    // Offset makes the patient's comfortable voice read as the clinician's
    // judged loudness; the green floor starts at that same loudness.
    const offset = perceivedDb - meanDbFs;
    setActiveCalibrationOffset(offset);
    if (deviceId) {
      saveDeviceOffset(deviceId, offset);
      saveDeviceBaseline(deviceId, perceivedDb);
    }
    onDone();
  }, [perceivedDb, onDone]);

  return (
    <section>
      <p style={s.body}>
        When your clinician says go, the patient says &ldquo;ahhh&rdquo; in their
        normal voice and holds it for {CAPTURE_SECONDS} seconds.
      </p>

      {phase === "idle" && (
        <button style={s.btnPrimary} onClick={start}>
          Start microphone check
        </button>
      )}

      {phase === "capturing" && (
        <div style={s.captureBox}>
          <div style={s.countdown}>{countdown}</div>
          <p style={s.body}>Listening… keep the &ldquo;ahhh&rdquo; going.</p>
        </div>
      )}

      {phase === "measured" && (
        <div>
          <p style={s.body}>
            <strong>Clinician:</strong> set how loud the patient&apos;s voice
            actually was. This sets calibration and their starting target.
          </p>
          <div style={s.sliderRow}>
            <input
              type="range"
              min={50}
              max={85}
              step={1}
              value={perceivedDb}
              onChange={(e) => setPerceivedDb(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={s.sliderValue}>{perceivedDb} dB</span>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <button style={s.btnPrimary} onClick={accept}>
              Accept
            </button>
            <button style={s.btnSecondary} onClick={() => setPhase("idle")}>
              Try again
            </button>
          </div>
        </div>
      )}

      {error && <p style={s.error}>{error}</p>}
    </section>
  );
}

// ── Step 2: voice ─────────────────────────────────────────────────────────
const SAMPLE_PHRASE = "Great effort! Keep that volume up!";

function VoiceStep({ onDone }: { onDone: () => void }) {
  const [selected, setSelected] = useState<CoachVoiceId>(DEFAULT_COACH_VOICE);
  const [playing, setPlaying] = useState<CoachVoiceId | null>(null);
  const [model, setModel] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [progress, setProgress] = useState("Loading voice model (~82 MB)…");

  // Get every voice fully ready before enabling Play: download the model, then
  // pre-synthesize the sample for all four voices (in the worker). onnxruntime's
  // first inference is slow (~tens of seconds), so doing this up front means
  // each Play is instant and the clinician never waits after clicking.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await coachVoice.load((info) => {
        if (cancelled) return;
        if (info.status === "progress" && info.name && info.progress != null) {
          setProgress(
            `Downloading ${info.name.split("/").at(-1)} — ${Math.round(
              info.progress,
            )}%`,
          );
        }
      });
      if (cancelled) return;
      if (!coachVoice.isKokoroReady()) {
        setModel("fallback");
        return;
      }
      setProgress("Preparing voices…");
      for (const v of COACH_VOICES) {
        if (cancelled) return;
        coachVoice.setVoice(v.id);
        await coachVoice.prewarm([SAMPLE_PHRASE]);
      }
      coachVoice.setVoice(DEFAULT_COACH_VOICE);
      if (!cancelled) setModel("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sample = useCallback(async (id: CoachVoiceId) => {
    setSelected(id);
    setPlaying(id);
    coachVoice.setVoice(id);
    // Samples are pre-cached above, so this plays instantly. The wait budget is
    // just a safety net.
    await coachVoice.speak(SAMPLE_PHRASE, { maxWaitMs: 15000 });
    setPlaying(null);
  }, []);

  const accept = useCallback(() => {
    coachVoice.setVoice(selected);
    saveCoachVoice(selected);
    onDone();
  }, [selected, onDone]);

  return (
    <section>
      <p style={s.body}>
        Play each voice and pick the one your clinician chooses.
      </p>
      {model === "loading" && <p style={s.loadingNote}>{progress}</p>}
      {model === "fallback" && (
        <p style={s.error}>
          The neural voices couldn&apos;t load on this device, so the browser
          voice is used — all options will sound the same. Pick one and continue.
        </p>
      )}
      {COACH_VOICES.map((v) => (
        <div
          key={v.id}
          style={{
            ...s.voiceRow,
            borderColor: selected === v.id ? "#2a7c7c" : "#e5e7eb",
          }}
        >
          <button
            style={{
              ...(playing === v.id ? s.btnPlayOn : s.btnPlay),
              opacity: model === "loading" ? 0.5 : 1,
            }}
            disabled={model === "loading"}
            onClick={() => sample(v.id)}
          >
            {model === "loading"
              ? "Preparing voices…"
              : playing === v.id
                ? "▶ Playing…"
                : "▶ Play"}
          </button>
          <span style={{ flex: 1 }}>{v.label}</span>
          <button
            style={selected === v.id ? s.btnChosen : s.btnSecondary}
            onClick={() => setSelected(v.id)}
          >
            {selected === v.id ? "✓ Chosen" : "Choose"}
          </button>
        </div>
      ))}
      <button style={{ ...s.btnPrimary, marginTop: 20 }} onClick={accept}>
        Save voice &amp; continue
      </button>
    </section>
  );
}

// ── Step 3: verbosity ─────────────────────────────────────────────────────
const LEVELS: { id: CoachingLevel; label: string; desc: string }[] = [
  { id: "minimal", label: "Minimal", desc: "Visual cue only — no voice during the rep." },
  { id: "standard", label: "Standard", desc: "A spoken cue with gentle in-rep encouragement." },
  { id: "encouraging", label: "Encouraging", desc: "More frequent spoken encouragement throughout." },
];

function VerbosityStep({ onDone }: { onDone: () => void }) {
  const [level, setLevel] = useState<CoachingLevel>("standard");

  const accept = useCallback(() => {
    saveCoachingLevel(level);
    onDone();
  }, [level, onDone]);

  return (
    <section>
      <p style={s.body}>Choose how much the coach speaks during each round.</p>
      {LEVELS.map((l) => (
        <button
          key={l.id}
          onClick={() => setLevel(l.id)}
          style={{
            ...s.levelRow,
            borderColor: level === l.id ? "#2a7c7c" : "#e5e7eb",
            background: level === l.id ? "#e0f2f2" : "#fafafa",
          }}
        >
          <span style={{ fontWeight: 700 }}>{l.label}</span>
          <span style={{ fontSize: 13, color: "#555" }}>{l.desc}</span>
        </button>
      ))}
      <button style={{ ...s.btnPrimary, marginTop: 20 }} onClick={accept}>
        Save and finish
      </button>
    </section>
  );
}

// ── Done ────────────────────────────────────────────────────────────────────
function DoneStep() {
  // Mark setup complete once the final screen mounts.
  useEffect(() => {
    saveSetupComplete(true);
  }, []);
  return (
    <section>
      <p style={s.body}>
        All done! These settings are saved on this device. You can close this and
        open the main app.
      </p>
      <Link href="/" style={s.btnPrimary}>
        Go to Say Ah
      </Link>
    </section>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 560,
    margin: "0 auto",
    padding: "32px 20px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#111",
  },
  header: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: 700 },
  stepTag: { fontSize: 13, color: "#2a7c7c", fontWeight: 600 },
  body: { fontSize: 16, color: "#444", lineHeight: 1.5, marginBottom: 16 },
  btnPrimary: {
    display: "inline-block",
    background: "#2a7c7c",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 22px",
    fontSize: 16,
    cursor: "pointer",
    fontWeight: 600,
    textDecoration: "none",
  },
  btnSecondary: {
    background: "#f3f4f6",
    color: "#333",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    cursor: "pointer",
  },
  btnChosen: {
    background: "#2a7c7c",
    color: "#fff",
    border: "1px solid #2a7c7c",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 600,
  },
  captureBox: { textAlign: "center", padding: "24px 0" },
  countdown: { fontSize: 64, fontWeight: 800, color: "#2a7c7c" },
  sliderRow: { display: "flex", alignItems: "center", gap: 16, marginTop: 12 },
  sliderValue: { fontSize: 20, fontWeight: 700, minWidth: 64, textAlign: "right" },
  voiceRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    marginBottom: 8,
    background: "#fafafa",
    border: "2px solid #e5e7eb",
    borderRadius: 8,
  },
  btnPlay: {
    background: "#e0f2f2",
    color: "#2a7c7c",
    border: "1px solid #a7d4d4",
    borderRadius: 6,
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  btnPlayOn: {
    background: "#2a7c7c",
    color: "#fff",
    border: "1px solid #2a7c7c",
    borderRadius: 6,
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  levelRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    marginBottom: 10,
    border: "2px solid #e5e7eb",
    borderRadius: 8,
    cursor: "pointer",
  },
  error: { color: "#b91c1c", fontSize: 14, marginTop: 14 },
  loadingNote: {
    fontSize: 20,
    fontWeight: 700,
    color: "#2a7c7c",
    marginBottom: 16,
  },
};
