"use client";

// ============================================================================
// SAY AH — AUDIO ANALYSER HOOK
//
// Port of the prototype's audio engine. Captures mic input, computes RMS each
// frame, runs onset/offset detection, and accumulates strip-chart points.
//
// Design notes:
// - The meter and timer update at 60 fps. We deliberately do NOT push these
//   into React state — that would re-render the entire screen on every frame.
//   Instead, the consumer passes `onLevel` and `onElapsed` callbacks that
//   write directly to a DOM ref (the prototype does the same thing).
// - `start()` returns immediately; `onComplete` fires when the rep finishes
//   (silence held > OFFSET_HOLD_MS, or MAX_REP_DURATION_SECONDS reached, or
//   the consumer calls `stop()` after onset).
// - The AudioContext is created lazily on first `requestPermission()` so it
//   only happens after a user gesture (browsers require this).
// ============================================================================

import { useCallback, useEffect, useRef } from "react";
import {
  MAX_REP_DURATION_SECONDS,
  OFFSET_HOLD_MS,
  OFFSET_THRESHOLD,
  ONSET_THRESHOLD,
  STRAIN_THRESHOLD,
  STRIP_INTERVAL_MS,
  STRIP_MAX_POINTS,
} from "@/lib/constants";
import type { RepCompletion } from "@/lib/types";

interface RepAccumulator {
  onsetDetected: boolean;
  onsetTime: number | null;
  offsetStartTime: number | null;
  peakRMS: number;
  highAmplitudeTime: number;
  sumRMS: number;
  rmsCount: number;
  stripBuffer: number[];
  stripAccum: { sum: number; count: number; lastPush: number };
}

function freshAccumulator(): RepAccumulator {
  return {
    onsetDetected: false,
    onsetTime: null,
    offsetStartTime: null,
    peakRMS: 0,
    highAmplitudeTime: 0,
    sumRMS: 0,
    rmsCount: 0,
    stripBuffer: [],
    stripAccum: { sum: 0, count: 0, lastPush: 0 },
  };
}

function computeRMS(dataArray: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const n = (dataArray[i] - 128) / 128;
    sum += n * n;
  }
  return Math.min(1.0, Math.sqrt(sum / dataArray.length) * 2);
}

export interface AudioAnalyserCallbacks {
  /** Called every frame with current RMS (0..1). Use for the meter. */
  onLevel?: (rms: number) => void;
  /** Called every frame with elapsed seconds since onset (0 before onset). */
  onElapsed?: (seconds: number) => void;
  /** Called whenever a new 0.5 s strip-chart point is committed. */
  onStripUpdate?: (buffer: number[]) => void;
  /** Called when voice is first detected. */
  onOnset?: () => void;
}

export interface UseAudioAnalyser {
  /** Request mic access. Resolves true on success. Safe to call multiple times. */
  requestPermission: () => Promise<boolean>;
  /** Begin a rep. `onComplete` fires once when the rep ends. */
  start: (
    callbacks: AudioAnalyserCallbacks,
    onComplete: (result: RepCompletion) => void,
  ) => void;
  /**
   * Manually stop the current rep. If onset has occurred, completes the rep.
   * If not, silently restarts the listen loop (matches prototype behaviour).
   */
  stop: () => void;
  /** Whether the mic is currently granted. */
  isReady: () => boolean;
}

export function useAudioAnalyser(): UseAudioAnalyser {
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Explicit ArrayBuffer generic — `getByteTimeDomainData` rejects
  // `Uint8Array<ArrayBufferLike>` (the default) under TS strict mode.
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const repRef = useRef<RepAccumulator>(freshAccumulator());
  const callbacksRef = useRef<AudioAnalyserCallbacks>({});
  const onCompleteRef = useRef<((r: RepCompletion) => void) | null>(null);

  // Per-rep audio recording (for the "Hear your voice" playback feature on
  // the result screen). MediaRecorder is created fresh for each rep, started
  // alongside the analyser loop, and stopped when the rep ends. The blob URL
  // is included in the RepCompletion payload. We hold the most recent URL
  // here so we can revoke it when the next rep starts (avoids leaks).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const lastAudioUrlRef = useRef<string | null>(null);

  const stopLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (mediaStreamRef.current) return true;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioContextRef.current = new AudioCtx();
      // Audio constraints — these matter A LOT for level measurement.
      //
      //   autoGainControl: false  ← critical. Browser default is `true`,
      //     which compresses dynamic range over a multi-second window. On
      //     sustained "ahhh" phonation it pulls the gain down and makes the
      //     user appear to fade even when they're holding constant volume.
      //     Disabling it gives raw, stable level data.
      //
      //   noiseSuppression: false  ← also off. Suppression algorithms
      //     subtly reshape the signal in ways that can affect RMS readings.
      //     For a voice exercise app where the user is in a quiet space,
      //     unprocessed signal is more reliable than processed signal.
      //
      //   echoCancellation: true  ← KEEP ON. We need it because the
      //     real-time coach plays TTS through the speakers while we're
      //     measuring; without AEC the TTS feeds back into the mic and
      //     inflates the level.
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const source = audioContextRef.current.createMediaStreamSource(
        mediaStreamRef.current,
      );
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256; // small = low latency
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(
        new ArrayBuffer(analyser.frequencyBinCount),
      );
      return true;
    } catch (err) {
      console.error("Audio init failed:", err);
      return false;
    }
  }, []);

  const finishRep = useCallback((duration: number) => {
    stopLoop();
    const r = repRef.current;
    const avgRMS = r.rmsCount > 0 ? r.sumRMS / r.rmsCount : 0;
    const finalStripBuffer = [...r.stripBuffer];
    const callback = onCompleteRef.current;
    onCompleteRef.current = null;

    // The recorder stop is async — we have to wait for the `stop` event to
    // fire before the chunks are flushed. Build the blob URL inside that
    // handler, then call the consumer's onComplete with everything bundled.
    const finalize = (audioUrl?: string) => {
      if (callback) {
        callback({
          duration,
          avgRMS,
          peakRMS: r.peakRMS,
          highAmplitudeTime: r.highAmplitudeTime,
          stripBuffer: finalStripBuffer,
          audioUrl,
        });
      }
    };

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        recorderRef.current = null;
        if (chunks.length === 0) {
          finalize();
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        lastAudioUrlRef.current = url;
        finalize(url);
      };
      try {
        recorder.stop();
      } catch {
        // Defensive: if stop() throws (e.g., recorder already stopped),
        // just finalize without audio.
        recorderRef.current = null;
        recordedChunksRef.current = [];
        finalize();
      }
    } else {
      finalize();
    }
  }, [stopLoop]);

  const runLoop = useCallback(() => {
    const loop = () => {
      const analyser = analyserRef.current;
      const data = dataArrayRef.current;
      if (!analyser || !data) return;

      analyser.getByteTimeDomainData(data);
      const rms = computeRMS(data);
      const r = repRef.current;
      const cbs = callbacksRef.current;

      cbs.onLevel?.(rms);

      // Strain metrics
      r.peakRMS = Math.max(r.peakRMS, rms);
      if (rms > STRAIN_THRESHOLD) r.highAmplitudeTime += 16; // ~16 ms/frame

      // ---- ONSET ----
      if (!r.onsetDetected && rms > ONSET_THRESHOLD) {
        r.onsetDetected = true;
        r.onsetTime = Date.now();
        r.offsetStartTime = null;
        r.stripAccum.lastPush = Date.now();
        cbs.onOnset?.();
      }

      // ---- TIMER + LOUDNESS ACCUMULATION ----
      if (r.onsetDetected && r.onsetTime !== null) {
        r.sumRMS += rms;
        r.rmsCount++;

        // Strip chart: accumulate and flush every STRIP_INTERVAL_MS
        r.stripAccum.sum += rms;
        r.stripAccum.count++;
        const nowMs = Date.now();
        if (nowMs - r.stripAccum.lastPush >= STRIP_INTERVAL_MS) {
          const avg =
            r.stripAccum.count > 0 ? r.stripAccum.sum / r.stripAccum.count : 0;
          r.stripBuffer.push(avg);
          if (r.stripBuffer.length > STRIP_MAX_POINTS) r.stripBuffer.shift();
          r.stripAccum = { sum: 0, count: 0, lastPush: nowMs };
          cbs.onStripUpdate?.(r.stripBuffer);
        }

        const elapsed = (Date.now() - r.onsetTime) / 1000;
        cbs.onElapsed?.(elapsed);

        if (elapsed >= MAX_REP_DURATION_SECONDS) {
          finishRep(elapsed);
          return;
        }
      }

      // ---- OFFSET DETECTION ----
      if (r.onsetDetected && r.onsetTime !== null) {
        if (rms < OFFSET_THRESHOLD) {
          if (!r.offsetStartTime) r.offsetStartTime = Date.now();
        } else {
          r.offsetStartTime = null; // voice came back
        }

        if (r.offsetStartTime) {
          const heldSilence = Date.now() - r.offsetStartTime;
          if (heldSilence >= OFFSET_HOLD_MS) {
            const duration = (Date.now() - r.onsetTime) / 1000;
            finishRep(duration);
            return;
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(loop);
    };
    animationFrameRef.current = requestAnimationFrame(loop);
  }, [finishRep]);

  const start = useCallback(
    (
      callbacks: AudioAnalyserCallbacks,
      onComplete: (result: RepCompletion) => void,
    ) => {
      callbacksRef.current = callbacks;
      onCompleteRef.current = onComplete;
      repRef.current = freshAccumulator();
      stopLoop();

      // Revoke the previous rep's audio URL — by the time start() is called
      // the result screen has already been dismissed and the playback
      // <audio> element torn down, so the URL is no longer needed.
      if (lastAudioUrlRef.current) {
        URL.revokeObjectURL(lastAudioUrlRef.current);
        lastAudioUrlRef.current = null;
      }

      // Start a fresh MediaRecorder. The stream is shared with the analyser,
      // and the browser allows multiple consumers of a single MediaStream.
      // Wrapped in try/catch because MediaRecorder can throw on unsupported
      // mimeTypes or unavailable APIs (older Safari, etc.) — in that case
      // we just skip recording and the playback button won't appear.
      recordedChunksRef.current = [];
      recorderRef.current = null;
      if (mediaStreamRef.current && typeof MediaRecorder !== "undefined") {
        try {
          const recorder = new MediaRecorder(mediaStreamRef.current);
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunksRef.current.push(e.data);
          };
          recorderRef.current = recorder;
          recorder.start();
        } catch (err) {
          console.warn("MediaRecorder unavailable, skipping playback:", err);
          recorderRef.current = null;
        }
      }

      if (analyserRef.current) runLoop();
    },
    [runLoop, stopLoop],
  );

  const stop = useCallback(() => {
    const r = repRef.current;
    if (!r.onsetDetected) {
      // No onset yet — silently restart the listen loop (prototype behaviour:
      // avoids alarming the user if they hit Stop before producing sound).
      stopLoop();
      setTimeout(() => {
        if (analyserRef.current && onCompleteRef.current) {
          repRef.current = freshAccumulator();
          runLoop();
        }
      }, 300);
      return;
    }
    if (r.onsetTime !== null) {
      const duration = (Date.now() - r.onsetTime) / 1000;
      finishRep(duration);
    }
  }, [finishRep, runLoop, stopLoop]);

  const isReady = useCallback(() => mediaStreamRef.current !== null, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLoop();
      // Stop any in-flight recorder before tearing the stream down.
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          // Ignore — recorder may already be stopping.
        }
      }
      recorderRef.current = null;
      recordedChunksRef.current = [];
      if (lastAudioUrlRef.current) {
        URL.revokeObjectURL(lastAudioUrlRef.current);
        lastAudioUrlRef.current = null;
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      audioContextRef.current?.close();
      audioContextRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
    };
  }, [stopLoop]);

  return { requestPermission, start, stop, isReady };
}
