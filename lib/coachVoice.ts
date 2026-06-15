"use client";

// ============================================================================
// SAY AH — COACH VOICE (Kokoro neural TTS, off-main-thread)
//
// Drives lib/coachVoice.worker.ts, which hosts Kokoro in a Web Worker so
// synthesis never blocks the UI thread (it was freezing the tab for tens of
// seconds on the main thread). Strategy for a never-laggy experience:
//
//   - Short cue phrases are pre-synthesized (in the worker) on the pre-rep
//     screen and cached as AudioBuffers, so during a rep they play instantly.
//   - speak() plays a cached buffer immediately; if not cached it falls back to
//     Web Speech right away (no waiting), and the worker fills the cache in the
//     background for next time. A caller can opt to wait briefly (maxWaitMs)
//     for Kokoro — used for post-rep messages, which can't be pre-cached.
//   - If the worker or Kokoro can't load at all, everything degrades to Web
//     Speech so the coach is never silent.
//
// Default voice af_heart (grade A in the blind test). Speed 1.0 (natural) —
// the old Web Speech path pushed rate up, which clinicians called "rushed".
// ============================================================================

import { speakMessage, cancelSpeech } from "./tts";

export type CoachVoiceId = "af_heart" | "af_bella" | "bf_emma" | "am_michael";

export const DEFAULT_COACH_VOICE: CoachVoiceId = "af_heart";

export const COACH_VOICES: { id: CoachVoiceId; label: string }[] = [
  { id: "af_heart", label: "Heart — warm female (A)" },
  { id: "af_bella", label: "Bella — energetic female (A−)" },
  { id: "bf_emma", label: "Emma — British female (B−)" },
  { id: "am_michael", label: "Michael — calm male (C+)" },
];

export interface CoachVoiceProgress {
  status: string;
  name?: string;
  progress?: number;
}

interface AudioMsg {
  type: "audio";
  id: number;
  audio: Float32Array<ArrayBuffer>;
  samplingRate: number;
}
interface ProgressMsg {
  type: "progress";
  info: CoachVoiceProgress;
}
interface LoadedMsg {
  type: "loaded";
}
interface LoadErrorMsg {
  type: "loadError";
  message: string;
}
interface GenErrorMsg {
  type: "genError";
  id: number;
  message: string;
}
type WorkerMsg = AudioMsg | ProgressMsg | LoadedMsg | LoadErrorMsg | GenErrorMsg;

class CoachVoiceService {
  private worker: Worker | null = null;
  private workerFailed = false;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private loadResolve: (() => void) | null = null;
  private onProgress: ((info: CoachVoiceProgress) => void) | null = null;

  private ctx: AudioContext | null = null;
  private current: AudioBufferSourceNode | null = null;
  private voice: CoachVoiceId = DEFAULT_COACH_VOICE;
  private cache = new Map<string, AudioBuffer>();

  // Pending generate requests, keyed by message id.
  private nextId = 1;
  private pending = new Map<
    number,
    { key: string; resolve: (b: AudioBuffer | null) => void }
  >();
  // De-dupe concurrent synths of the same phrase.
  private inFlight = new Map<string, Promise<AudioBuffer | null>>();

  setVoice(voice: CoachVoiceId): void {
    this.voice = voice;
  }

  getVoice(): CoachVoiceId {
    return this.voice;
  }

  isKokoroReady(): boolean {
    return this.loaded;
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
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private getWorker(): Worker | null {
    if (this.workerFailed) return null;
    if (this.worker) return this.worker;
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      return null;
    }
    try {
      this.worker = new Worker(
        new URL("./coachVoice.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (e: MessageEvent<WorkerMsg>) =>
        this.handleMessage(e.data);
      this.worker.onerror = () => this.failWorker();
      return this.worker;
    } catch (err) {
      console.warn("Coach voice worker unavailable; using Web Speech:", err);
      this.workerFailed = true;
      return null;
    }
  }

  private failWorker(): void {
    this.workerFailed = true;
    this.loaded = false;
    // Resolve any waiters so callers fall back to Web Speech.
    this.pending.forEach(({ resolve }) => resolve(null));
    this.pending.clear();
    this.loadResolve?.();
    this.loadResolve = null;
  }

  private handleMessage(msg: WorkerMsg): void {
    switch (msg.type) {
      case "progress":
        this.onProgress?.(msg.info);
        break;
      case "loaded":
        this.loaded = true;
        this.loadResolve?.();
        this.loadResolve = null;
        break;
      case "loadError":
        console.warn("Kokoro load failed; using Web Speech:", msg.message);
        this.failWorker();
        break;
      case "audio": {
        const entry = this.pending.get(msg.id);
        if (!entry) break;
        this.pending.delete(msg.id);
        const ctx = this.getCtx();
        if (!ctx) {
          entry.resolve(null);
          break;
        }
        const buf = ctx.createBuffer(1, msg.audio.length, msg.samplingRate);
        buf.copyToChannel(msg.audio, 0);
        this.cache.set(entry.key, buf);
        entry.resolve(buf);
        break;
      }
      case "genError": {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.resolve(null);
        }
        break;
      }
    }
  }

  /** Load the Kokoro model in the worker. Idempotent. */
  load(onProgress?: (info: CoachVoiceProgress) => void): Promise<void> {
    if (this.loaded || this.workerFailed) return Promise.resolve();
    if (onProgress) this.onProgress = onProgress;
    if (!this.loadPromise) {
      const worker = this.getWorker();
      if (!worker) return Promise.resolve();
      this.loadPromise = new Promise((resolve) => {
        this.loadResolve = resolve;
        worker.postMessage({ type: "load" });
      });
    }
    return this.loadPromise;
  }

  /** Synthesize one phrase in the worker (de-duped, cached). */
  private synth(
    key: string,
    text: string,
    speed: number,
    priority: "high" | "low" = "high",
  ): Promise<AudioBuffer | null> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const worker = this.getWorker();
    if (!worker) return Promise.resolve(null);

    const id = this.nextId++;
    const p = new Promise<AudioBuffer | null>((resolve) => {
      this.pending.set(id, { key, resolve });
      worker.postMessage({
        type: "generate",
        id,
        text,
        voice: this.voice,
        speed,
        priority,
      });
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  /**
   * Pre-synthesize and cache phrases in the worker (off the main thread). Safe
   * to call repeatedly — cached phrases are skipped. No-op if Kokoro is
   * unavailable. Runs sequentially so it doesn't flood the worker queue.
   */
  async prewarm(phrases: string[], speed = 1.0): Promise<void> {
    await this.load();
    if (!this.loaded) return;
    for (const text of phrases) {
      const key = `${this.voice}|${speed}|${text}`;
      if (this.cache.has(key)) continue;
      // Low priority so live cues / post-rep messages always synth first.
      await this.synth(key, text, speed, "low");
    }
  }

  /**
   * Speak a phrase. Plays a cached Kokoro buffer instantly; otherwise falls
   * back to Web Speech immediately (and caches Kokoro in the background) unless
   * `maxWaitMs` is given, in which case it waits up to that long for Kokoro
   * before falling back. `speed` defaults to 1.0 (natural).
   */
  async speak(
    text: string,
    opts?: { speed?: number; maxWaitMs?: number; allowWebFallback?: boolean },
  ): Promise<void> {
    if (!text) return;
    const speed = opts?.speed ?? 1.0;
    const maxWaitMs = opts?.maxWaitMs ?? 0;
    // When false (in-rep cues), never use the Web Speech voice — play Kokoro if
    // ready, otherwise stay silent (the on-screen text cue still shows). This
    // avoids the robotic voice mixing with Kokoro mid-utterance.
    const allowWeb = opts?.allowWebFallback ?? true;
    const key = `${this.voice}|${speed}|${text}`;

    const cached = this.cache.get(key);
    if (cached) {
      this.playBuffer(cached);
      return;
    }

    if (!this.workerFailed && this.getWorker()) {
      const synthP = this.synth(key, text, speed);
      if (maxWaitMs > 0) {
        const buf = await Promise.race([
          synthP,
          new Promise<null>((r) => setTimeout(() => r(null), maxWaitMs)),
        ]);
        if (buf) {
          this.playBuffer(buf);
          return;
        }
        // Timed out — fall through to Web Speech; synthP still caches for later.
      } else {
        // Don't wait — the worker caches in the background for next time.
        void synthP;
      }
    }

    if (allowWeb) {
      this.stopBuffer();
      speakMessage(text);
    }
  }

  private stopBuffer(): void {
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
    this.current = null;
  }

  private playBuffer(buf: AudioBuffer): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    // Stop the other channel too, so Kokoro never overlaps a still-talking Web
    // Speech utterance (the "two voices at once" bug).
    cancelSpeech();
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

// Module-level singleton — one worker, model load, and cache for the app.
export const coachVoice = new CoachVoiceService();
