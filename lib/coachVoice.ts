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
  { id: "af_heart", label: "Heart (warm female)" },
  { id: "af_bella", label: "Bella (energetic female)" },
  { id: "bf_emma", label: "Emma (British female)" },
  { id: "am_michael", label: "Michael (calm male)" },
];

// Energy boost applied to ALL coach audio at playback (Kokoro can't adjust
// energy itself — it only exposes voice + speed). A presence shelf brightens
// the timbre, a compressor adds punch/consistency, and make-up gain lifts
// loudness. Tune these to taste. All Web Audio nodes — Safari-safe.
const COACH_PRESENCE_HZ = 3000;
const COACH_PRESENCE_DB = 3.5;
const COACH_MAKEUP_GAIN = 1.4;

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
  private outputNode: AudioNode | null = null;
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

  // Static pre-generated audio (see scripts/generate-coach-audio + public/coach/
  // manifest.json). Per voice: cues (text -> url, played instantly so in-rep
  // cues always come through) and a fallback batch (urls, dealt non-recycling
  // for post-rep). All in the chosen voice; no model needed.
  private manifest: Record<
    string,
    { cues: Record<string, string>; fallback: string[]; sample?: string }
  > | null = null;
  private manifestPromise: Promise<void> | null = null;
  private staticBufs = new Map<string, AudioBuffer>(); // url -> buffer
  private fallbackDeck = new Map<string, number[]>(); // voice -> remaining indices

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

  // Shared energy-boost chain: source → presence shelf → compressor → make-up
  // gain → speakers. Built once per context; all playback routes through it.
  private getOutputNode(ctx: AudioContext): AudioNode {
    if (this.outputNode && this.outputNode.context === ctx) {
      return this.outputNode;
    }
    const input = ctx.createGain();
    const presence = ctx.createBiquadFilter();
    presence.type = "highshelf";
    presence.frequency.value = COACH_PRESENCE_HZ;
    presence.gain.value = COACH_PRESENCE_DB;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 24;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const makeup = ctx.createGain();
    makeup.gain.value = COACH_MAKEUP_GAIN;
    input.connect(presence);
    presence.connect(comp);
    comp.connect(makeup);
    makeup.connect(ctx.destination);
    this.outputNode = input;
    return input;
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
   * Kick off the model download and pay the slow first-inference cost in the
   * background, off the critical path (never awaited). Call this once the chosen
   * voice is known (end of setup) so that by the first rep the model is loaded
   * and warm, and the personalized post-rep line plays in the chosen voice.
   */
  warmModel(): void {
    void (async () => {
      await this.load();
      if (!this.loaded) return;
      // One throwaway low-priority synth so onnxruntime's cold first inference
      // happens now, not during the first post-rep message.
      await this.prewarm(["Nice work!"]);
    })();
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
    src.connect(this.getOutputNode(ctx));
    src.onended = () => {
      if (this.current === src) this.current = null;
    };
    src.start();
    this.current = src;
  }

  // ── Static pre-generated audio ───────────────────────────────────────────

  private loadManifest(): Promise<void> {
    if (this.manifest) return Promise.resolve();
    if (!this.manifestPromise) {
      this.manifestPromise = fetch("/coach/manifest.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => {
          this.manifest = m;
        })
        .catch(() => {
          /* no manifest → static audio simply unavailable */
        });
    }
    return this.manifestPromise;
  }

  private voiceEntry() {
    return this.manifest?.[this.voice] ?? this.manifest?.[DEFAULT_COACH_VOICE];
  }

  private async fetchStaticBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.staticBufs.get(url);
    if (cached) return cached;
    const ctx = this.getCtx();
    if (!ctx) return null;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buf = await ctx.decodeAudioData(await resp.arrayBuffer());
      this.staticBufs.set(url, buf);
      return buf;
    } catch {
      return null;
    }
  }

  /** Next fallback URL for the current voice, dealt without repeating until the
   * deck is exhausted (then reshuffled). */
  private nextFallbackUrl(): string | null {
    const urls = this.voiceEntry()?.fallback;
    if (!urls || urls.length === 0) return null;
    let deck = this.fallbackDeck.get(this.voice);
    if (!deck || deck.length === 0) {
      deck = urls.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      this.fallbackDeck.set(this.voice, deck);
    }
    const idx = deck.pop();
    return idx === undefined ? null : urls[idx];
  }

  /** Warm the static buffers (cues + fallback) for the current voice so the
   * first plays without a fetch/decode hitch. Runs in the background. */
  async prefetchStatic(): Promise<void> {
    await this.loadManifest();
    const entry = this.voiceEntry();
    if (!entry) return;
    const urls = [...Object.values(entry.cues), ...entry.fallback];
    if (entry.sample) urls.push(entry.sample);
    for (const url of urls) await this.fetchStaticBuffer(url);
  }

  /** Warm just the setup preview clip for the current voice, so the first Play
   * on the /setup voice step is instant (no fetch/decode hitch). */
  async prefetchSample(): Promise<void> {
    await this.loadManifest();
    const url = this.voiceEntry()?.sample;
    if (url) await this.fetchStaticBuffer(url);
  }

  /** Play the static setup preview clip for the current voice. Instant, in
   * voice, no model needed. Stays SILENT if unavailable — never the web voice. */
  async speakSample(): Promise<void> {
    await this.loadManifest();
    const url = this.voiceEntry()?.sample;
    if (!url) return;
    const buf = await this.fetchStaticBuffer(url);
    if (buf) this.playBuffer(buf);
  }

  /**
   * Play an in-rep cue from its static file (always available, instant, in
   * voice). Falls back to a freshly-synthesized buffer if cached, else stays
   * SILENT (the on-screen text cue still shows) — never the web voice.
   */
  async speakCue(text: string): Promise<void> {
    if (!text) return;
    await this.loadManifest();
    const url = this.voiceEntry()?.cues?.[text];
    if (url) {
      const buf = await this.fetchStaticBuffer(url);
      if (buf) {
        this.playBuffer(buf);
        return;
      }
    }
    const cached = this.cache.get(`${this.voice}|1|${text}`);
    if (cached) this.playBuffer(cached);
  }

  /** Play one non-recycling fallback phrase in the chosen voice. Returns false
   * if no fallback audio is available. */
  async playFallback(): Promise<boolean> {
    await this.loadManifest();
    const url = this.nextFallbackUrl();
    if (!url) return false;
    const buf = await this.fetchStaticBuffer(url);
    if (!buf) return false;
    this.playBuffer(buf);
    return true;
  }

  /**
   * Speak a CONTEXTUAL message (responsive to the actual rep). Tries a fresh
   * Kokoro synth first — but only if the model is already loaded, so we don't
   * trigger the 82 MB download just for this. If fresh isn't ready within
   * `maxWaitMs`, plays a non-recycling static fallback in the chosen voice
   * (never the robotic web voice unless even the fallback is unavailable).
   */
  async speakContextual(
    text: string,
    opts?: { maxWaitMs?: number },
  ): Promise<void> {
    if (!text) return;
    const maxWaitMs = opts?.maxWaitMs ?? 3000;
    const key = `${this.voice}|1|${text}`;

    const cached = this.cache.get(key);
    if (cached) {
      this.playBuffer(cached);
      return;
    }
    if (this.loaded && !this.workerFailed) {
      const synthP = this.synth(key, text, 1.0, "high");
      const buf = await Promise.race([
        synthP,
        new Promise<null>((r) => setTimeout(() => r(null), maxWaitMs)),
      ]);
      if (buf) {
        this.playBuffer(buf);
        return;
      }
      // Timed out — synthP keeps caching for a later identical message.
    }
    if (await this.playFallback()) return;
    this.stopBuffer();
    speakMessage(text); // last resort
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
