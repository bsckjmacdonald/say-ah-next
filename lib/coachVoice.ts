"use client";

// ============================================================================
// SAY AH — COACH VOICE (Kokoro neural TTS)
//
// Replaces the browser Web Speech coach with Kokoro-82M (kokoro-js, Apache 2.0)
// running in-browser via ONNX Runtime (wasm). Clinician feedback on the old
// browser TTS: "robotic", "rushed", "jarring". This module addresses all three:
//
//   - Warm neural voice (default af_heart — grade A in the blind listening test;
//     see ~/Documents/Claude/LSVT/projects/lsvt_voice_test/WRITEUP.md). The
//     clinician picks the voice during /setup from a graded shortlist.
//   - "Rushed" fix: synthesize at speed 1.0 (natural). The old code pushed the
//     Web Speech `rate` up to sound energetic, which read as rushed.
//   - "Clipped/jarring" fix: short cue phrases are PRE-SYNTHESIZED and cached so
//     they play instantly from an AudioBuffer instead of being cut off by
//     `speechSynthesis.cancel()` mid-word (the old failure mode).
//
// Falls back to Web Speech (lib/tts.ts) when Kokoro is unavailable or still
// loading, so the coach is never silent. The ~82 MB model is cached by the
// browser after first load; pre-warm it during the countdown.
// ============================================================================

import { speakMessage, cancelSpeech } from "./tts";

export type CoachVoiceId = "af_heart" | "af_bella" | "bf_emma" | "am_michael";

export const DEFAULT_COACH_VOICE: CoachVoiceId = "af_heart";

// Curated shortlist for the /setup voice picker — the four voices from the blind
// listening test, ordered by grade. The clinician chooses from these, not all
// 54 Kokoro voices.
export const COACH_VOICES: { id: CoachVoiceId; label: string }[] = [
  { id: "af_heart", label: "Heart — warm female (A)" },
  { id: "af_bella", label: "Bella — energetic female (A−)" },
  { id: "bf_emma", label: "Emma — British female (B−)" },
  { id: "am_michael", label: "Michael — calm male (C+)" },
];

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Minimal structural type for the kokoro-js instance — avoids depending on the
// library's transitive @huggingface/transformers types. Matches the working
// usage in app/tts-test/page.tsx.
interface KokoroInstance {
  generate(
    text: string,
    opts?: { voice?: string; speed?: number },
  ): Promise<{ audio: Float32Array | ArrayLike<number>; sampling_rate?: number }>;
}

export interface CoachVoiceProgress {
  status: string;
  name?: string;
  progress?: number;
}

class CoachVoiceService {
  private tts: KokoroInstance | null = null;
  private loadPromise: Promise<void> | null = null;
  private kokoroFailed = false;
  private ctx: AudioContext | null = null;
  private current: AudioBufferSourceNode | null = null;
  private voice: CoachVoiceId = DEFAULT_COACH_VOICE;
  // Cache key is `${voice}|${speed}|${text}` so a voice or speed change does not
  // serve stale audio.
  private cache = new Map<string, AudioBuffer>();

  setVoice(voice: CoachVoiceId): void {
    this.voice = voice;
  }

  getVoice(): CoachVoiceId {
    return this.voice;
  }

  isKokoroReady(): boolean {
    return this.tts !== null;
  }

  private getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx || this.ctx.state === "closed") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    // Autoplay policy can suspend the context; resume so playback isn't silent
    // (same class of bug as the WS3 capture fix).
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /**
   * Load the Kokoro model. Idempotent and safe to call repeatedly — concurrent
   * callers share one load. On failure, falls back to Web Speech permanently
   * (no repeated download attempts within the session).
   */
  load(onProgress?: (info: CoachVoiceProgress) => void): Promise<void> {
    if (this.tts || this.kokoroFailed) return Promise.resolve();
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const { KokoroTTS } = await import("kokoro-js");
          this.tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
            dtype: "q8",
            device: "wasm",
            progress_callback: onProgress,
          })) as unknown as KokoroInstance;
        } catch (err) {
          console.warn("Kokoro load failed; using Web Speech fallback:", err);
          this.kokoroFailed = true;
        }
      })();
    }
    return this.loadPromise;
  }

  private async synth(
    text: string,
    speed: number,
  ): Promise<AudioBuffer | null> {
    const ctx = this.getCtx();
    if (!this.tts || !ctx) return null;
    try {
      const result = await this.tts.generate(text, { voice: this.voice, speed });
      const samples = new Float32Array(result.audio);
      const rate = result.sampling_rate ?? 24000;
      const buf = ctx.createBuffer(1, samples.length, rate);
      buf.copyToChannel(samples, 0);
      return buf;
    } catch (err) {
      console.warn("Kokoro synth failed:", err);
      return null;
    }
  }

  /**
   * Pre-synthesize and cache a set of fixed phrases (the real-time cue pool) so
   * they play with zero latency during a rep. Loads the model first if needed.
   * No-op (resolves) if Kokoro is unavailable — callers just get Web Speech.
   */
  async prewarm(phrases: string[], speed = 1.0): Promise<void> {
    await this.load();
    if (!this.tts) return;
    for (const text of phrases) {
      const key = `${this.voice}|${speed}|${text}`;
      if (this.cache.has(key)) continue;
      const buf = await this.synth(text, speed);
      if (buf) this.cache.set(key, buf);
    }
  }

  /**
   * Speak a phrase. Prefers a cached pre-synthesized buffer (instant), then
   * on-demand Kokoro synthesis, then Web Speech as a last resort so the coach
   * is never silent. `speed` defaults to 1.0 (natural — do not rush cues).
   */
  async speak(text: string, opts?: { speed?: number }): Promise<void> {
    if (!text) return;
    const speed = opts?.speed ?? 1.0;
    const key = `${this.voice}|${speed}|${text}`;

    const cached = this.cache.get(key);
    if (cached) {
      this.playBuffer(cached);
      return;
    }
    if (this.tts) {
      const buf = await this.synth(text, speed);
      if (buf) {
        this.cache.set(key, buf);
        this.playBuffer(buf);
        return;
      }
    }
    // Fallback: Web Speech. Keep the old gentle prosody for naturalness.
    speakMessage(text);
  }

  private playBuffer(buf: AudioBuffer): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    // Stop any still-playing cue cleanly before starting the next. Cues are
    // short and gated ~3 s apart, so this rarely fires — but it prevents two
    // buffers overlapping without the mid-word chop that cancel() caused.
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      if (this.current === src) this.current = null;
    };
    src.start();
    this.current = src;
  }

  /** Stop any in-progress coach audio (buffer playback and Web Speech). */
  cancel(): void {
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
    this.current = null;
    cancelSpeech();
  }
}

// Module-level singleton — one model load and cache shared across the app.
export const coachVoice = new CoachVoiceService();
