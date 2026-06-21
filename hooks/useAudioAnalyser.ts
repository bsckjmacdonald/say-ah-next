"use client";

// ============================================================================
// SAY AH — AUDIO ANALYSER HOOK
//
// Captures mic input, computes RMS each frame, runs onset/offset detection,
// and accumulates strip-chart points.
//
// Phase 1 additions:
// - AEC is tied to the coach toggle: coach on → AEC on (TTS needs it),
//   coach off → AEC off (cleaner signal for SPL accuracy).
// - After the stream opens, track.getSettings() verifies what the browser
//   actually delivered; the result is exposed as `constraintStatus`.
// - iOS: navigator.audioSession.type = 'play-and-record' keeps audio routed
//   to the speaker instead of the earpiece when the mic is active.
// - `deviceId` is exposed so callers can look up per-device calibration offsets.
// - `needsRecalibration` fires when a devicechange event is detected.
// - If coachEnabled changes while the stream is already open, the stream is
//   closed and reopened so the AEC state stays in sync.
//
// Design notes:
// - The meter and timer update at 60 fps; `onLevel` and `onElapsed` callbacks
//   write directly to DOM refs so React doesn't re-render on every frame.
// - The AudioContext is created lazily on first `requestPermission()` so it
//   only happens inside a user gesture.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAWeightingCoefficients } from "@/lib/aWeighting";
import {
  MAX_REP_DURATION_SECONDS,
  OFFSET_HOLD_MS,
  STRAIN_THRESHOLD,
  STRIP_INTERVAL_MS,
  STRIP_MAX_POINTS,
} from "@/lib/constants";
import { DEFAULT_BAND, type TargetBand } from "@/lib/calibration";
import type { AudioConstraintStatus, RepCompletion } from "@/lib/types";

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

function computeRMS(dataArray: Float32Array<ArrayBuffer>): number {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i] * dataArray[i];
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
   * If not, silently restarts the listen loop.
   */
  stop: () => void;
  /**
   * Lightweight live-level loop for the calibrate screen: calls `onLevel` with
   * the current RMS each frame, with no onset/offset/recording logic. Use
   * `stopMonitor` to end it.
   */
  startMonitor: (onLevel: (rms: number) => void) => void;
  stopMonitor: () => void;
  /** Whether the mic is currently granted. */
  isReady: () => boolean;
  /**
   * Revoke the most recent rep's blob URL early (before the next rep starts).
   * Used by the "Discard recording" control on the result screen.
   */
  discardCurrentAudio: () => void;
  /** What the browser actually delivered after getUserMedia. */
  constraintStatus: AudioConstraintStatus;
  /** deviceId from track.getSettings(), for per-device calibration lookup. */
  deviceId: string | null;
  /**
   * True after a devicechange event — caller should prompt the user to
   * re-calibrate. Call `dismissRecalibration()` to clear.
   */
  needsRecalibration: boolean;
  dismissRecalibration: () => void;
}

const UNKNOWN_CONSTRAINTS: AudioConstraintStatus = {
  agc: "unknown",
  aec: "unknown",
  noiseSuppression: "unknown",
};

function toStatus(v: boolean | undefined): "off" | "on" | "unknown" {
  return v === false ? "off" : v === true ? "on" : "unknown";
}

export function useAudioAnalyser({
  coachEnabled,
  band = DEFAULT_BAND,
}: {
  coachEnabled: boolean;
  /** Active target band. onset/offset detection thresholds are read from it. */
  band?: TargetBand;
}): UseAudioAnalyser {
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const monitorFrameRef = useRef<number | null>(null);
  // Always reflects the latest band prop, readable from the rAF loop (which is
  // created once and would otherwise close over a stale band). Synced via
  // effect so we never write a ref during render.
  const bandRef = useRef<TargetBand>(band);
  const repRef = useRef<RepAccumulator>(freshAccumulator());
  const callbacksRef = useRef<AudioAnalyserCallbacks>({});
  const onCompleteRef = useRef<((r: RepCompletion) => void) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const lastAudioUrlRef = useRef<string | null>(null);

  // The AEC value that was in effect when the stream was opened.
  const streamAecRef = useRef<boolean | null>(null);
  // Always reflects the latest coachEnabled prop, readable from callbacks.
  const coachEnabledRef = useRef(coachEnabled);

  const [constraintStatus, setConstraintStatus] =
    useState<AudioConstraintStatus>(UNKNOWN_CONSTRAINTS);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [needsRecalibration, setNeedsRecalibration] = useState(false);

  const stopLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Opens the mic stream and builds the audio graph. Idempotent with respect
  // to the AudioContext — it is created once and reused on subsequent calls.
  const openStream = useCallback(async (aec: boolean): Promise<boolean> => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      } else if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      // iOS Safari: keep audio routed to the speaker (not earpiece) when the
      // mic is active. Without this, playback is inaudible during a rep.
      try {
        const audioSession = (
          navigator as unknown as {
            audioSession?: { type: string };
          }
        ).audioSession;
        if (audioSession) audioSession.type = "play-and-record";
      } catch {
        // iOS-only API; no-op on other platforms.
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: aec,
          noiseSuppression: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });

      mediaStreamRef.current = stream;
      streamAecRef.current = aec;

      // Verify what the browser actually applied — constraints are advisory
      // and browsers silently ignore ones they can't honour.
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings() ?? {};
      setConstraintStatus({
        agc: toStatus(settings.autoGainControl),
        aec: toStatus(settings.echoCancellation),
        noiseSuppression: toStatus(settings.noiseSuppression),
      });
      setDeviceId(settings.deviceId ?? null);

      const source =
        audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;

      // Phase 2: A-weighting (IEC 61672-1) — filter runs on the audio thread
      // before the analyser so computeRMS sees the perceptually weighted signal.
      const { feedforward, feedback } = buildAWeightingCoefficients(
        audioContextRef.current.sampleRate,
      );
      const aWeightFilter =
        audioContextRef.current.createIIRFilter(feedforward, feedback);
      source.connect(aWeightFilter);
      aWeightFilter.connect(analyser);

      analyserRef.current = analyser;
      dataArrayRef.current = new Float32Array(
        new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
      );

      return true;
    } catch (err) {
      console.error("Audio init failed:", err);
      return false;
    }
  }, []);

  // Tears down the existing stream and reopens with the given AEC setting.
  // Safe to call between reps; disruptive if called mid-rep.
  const closeAndReopenStream = useCallback(
    async (aec: boolean) => {
      stopLoop();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
      streamAecRef.current = null;
      setConstraintStatus(UNKNOWN_CONSTRAINTS);
      setDeviceId(null);
      await openStream(aec);
    },
    [stopLoop, openStream],
  );

  // Sync coachEnabled ref and reinit the stream if the AEC state needs to
  // change. This fires between renders so it's safe between reps. Toggling the
  // coach flips AEC, which shifts the RMS scale — so any existing calibration
  // is now stale and we flag it for re-confirmation (same signal as a device
  // change).
  useEffect(() => {
    coachEnabledRef.current = coachEnabled;
    if (
      mediaStreamRef.current !== null &&
      streamAecRef.current !== coachEnabled
    ) {
      void (async () => {
        await closeAndReopenStream(coachEnabled);
        setNeedsRecalibration(true);
      })();
    }
  }, [coachEnabled, closeAndReopenStream]);

  // Keep the rAF-readable band ref in sync with the latest prop.
  useEffect(() => {
    bandRef.current = band;
  }, [band]);

  // Prompt re-calibration when the user plugs in or unplugs an audio device.
  useEffect(() => {
    const handleDeviceChange = async () => {
      if (!mediaStreamRef.current) return;
      await closeAndReopenStream(coachEnabledRef.current);
      setNeedsRecalibration(true);
    };
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
      return () =>
        navigator.mediaDevices.removeEventListener(
          "devicechange",
          handleDeviceChange,
        );
    }
  }, [closeAndReopenStream]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (mediaStreamRef.current) return true;
    return openStream(coachEnabledRef.current);
  }, [openStream]);

  const finishRep = useCallback(
    (duration: number) => {
      stopLoop();
      const r = repRef.current;
      const avgRMS = r.rmsCount > 0 ? r.sumRMS / r.rmsCount : 0;
      const finalStripBuffer = [...r.stripBuffer];
      const callback = onCompleteRef.current;
      onCompleteRef.current = null;

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
          recorderRef.current = null;
          recordedChunksRef.current = [];
          finalize();
        }
      } else {
        finalize();
      }
    },
    [stopLoop],
  );

  const runLoop = useCallback(() => {
    const loop = () => {
      const analyser = analyserRef.current;
      const data = dataArrayRef.current;
      if (!analyser || !data) return;

      analyser.getFloatTimeDomainData(data);
      const rms = computeRMS(data);
      const r = repRef.current;
      const cbs = callbacksRef.current;

      cbs.onLevel?.(rms);

      r.peakRMS = Math.max(r.peakRMS, rms);
      if (rms > STRAIN_THRESHOLD) r.highAmplitudeTime += 16;

      if (!r.onsetDetected && rms > bandRef.current.onset) {
        r.onsetDetected = true;
        r.onsetTime = Date.now();
        r.offsetStartTime = null;
        r.stripAccum.lastPush = Date.now();
        cbs.onOnset?.();
      }

      if (r.onsetDetected && r.onsetTime !== null) {
        r.sumRMS += rms;
        r.rmsCount++;

        r.stripAccum.sum += rms;
        r.stripAccum.count++;
        const nowMs = Date.now();
        if (nowMs - r.stripAccum.lastPush >= STRIP_INTERVAL_MS) {
          const avg =
            r.stripAccum.count > 0
              ? r.stripAccum.sum / r.stripAccum.count
              : 0;
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

      if (r.onsetDetected && r.onsetTime !== null) {
        if (rms < bandRef.current.offset) {
          if (!r.offsetStartTime) r.offsetStartTime = Date.now();
        } else {
          r.offsetStartTime = null;
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

      if (lastAudioUrlRef.current) {
        URL.revokeObjectURL(lastAudioUrlRef.current);
        lastAudioUrlRef.current = null;
      }

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

  const stopMonitor = useCallback(() => {
    if (monitorFrameRef.current !== null) {
      cancelAnimationFrame(monitorFrameRef.current);
      monitorFrameRef.current = null;
    }
  }, []);

  const startMonitor = useCallback(
    (onLevel: (rms: number) => void) => {
      // Don't run alongside a rep loop; calibration and reps never overlap.
      stopMonitor();
      const loop = () => {
        const analyser = analyserRef.current;
        const data = dataArrayRef.current;
        if (!analyser || !data) {
          monitorFrameRef.current = requestAnimationFrame(loop);
          return;
        }
        analyser.getFloatTimeDomainData(data);
        onLevel(computeRMS(data));
        monitorFrameRef.current = requestAnimationFrame(loop);
      };
      monitorFrameRef.current = requestAnimationFrame(loop);
    },
    [stopMonitor],
  );

  const isReady = useCallback(() => mediaStreamRef.current !== null, []);

  const discardCurrentAudio = useCallback(() => {
    if (lastAudioUrlRef.current) {
      URL.revokeObjectURL(lastAudioUrlRef.current);
      lastAudioUrlRef.current = null;
    }
  }, []);

  const dismissRecalibration = useCallback(
    () => setNeedsRecalibration(false),
    [],
  );

  useEffect(() => {
    return () => {
      stopLoop();
      stopMonitor();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore
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
  }, [stopLoop, stopMonitor]);

  return {
    requestPermission,
    start,
    stop,
    startMonitor,
    stopMonitor,
    isReady,
    discardCurrentAudio,
    constraintStatus,
    deviceId,
    needsRecalibration,
    dismissRecalibration,
  };
}
