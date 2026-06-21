"use client";

// ============================================================================
// CalibrateScreen — clinician sets the patient's target band for this session.
//
// The clinician's ear is the ground truth (see CONTEXT.md). They capture the
// BOTTOM of the band from the patient's quietest-acceptable voice, and either
// demo the TOP themselves (in person) or let it derive from the bottom (so a
// patient is never pushed to strain). Each capture is hold-to-record: we take
// the median RMS over the hold, which is robust to Parkinson's voice wobble.
//
// While this screen is open it keeps the session's working band in sync via
// onBandChange, so the live meter and the optional test rep both reflect the
// band being built. Commit persists it for this device; cancel reverts.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioMeter, AudioMeterHandle } from "@/components/AudioMeter";
import {
  bandFromAnchors,
  deriveLoudFromSoft,
  median,
  type TargetBand,
} from "@/lib/calibration";
import type { UseAudioAnalyser } from "@/hooks/useAudioAnalyser";
import type { RepCompletion } from "@/lib/types";

// Ignore captures shorter than this many frames (~a quick accidental tap).
const MIN_HOLD_FRAMES = 10;

interface Props {
  analyser: UseAudioAnalyser;
  /** Pre-filled band (from storage or default) the clinician confirms/re-demos. */
  band: TargetBand;
  /** Keeps the session band in sync as the working band is built. */
  onBandChange: (band: TargetBand) => void;
  /** Commit the band: persist for this device and start the session. */
  onCommit: (band: TargetBand) => void;
  /** Leave without committing; the caller restores the previous band. */
  onCancel: () => void;
}

type Capturing = "soft" | "loud" | null;

export function CalibrateScreen({
  analyser,
  band,
  onBandChange,
  onCommit,
  onCancel,
}: Props) {
  const [ready, setReady] = useState(analyser.isReady());
  const [softAnchor, setSoftAnchor] = useState<number>(band.soft);
  // null = derive the top from the bottom (the no-strain / remote default).
  const [loudAnchor, setLoudAnchor] = useState<number | null>(band.loud);
  const [capturing, setCapturing] = useState<Capturing>(null);
  const [testing, setTesting] = useState(false);
  const [testVerdict, setTestVerdict] = useState<string | null>(null);

  const meterRef = useRef<AudioMeterHandle>(null);
  const holdSamplesRef = useRef<number[]>([]);
  // Mirror of `capturing` readable from the monitor callback; synced via effect.
  const capturingRef = useRef<Capturing>(null);
  useEffect(() => {
    capturingRef.current = capturing;
  }, [capturing]);

  const workingBand = useMemo<TargetBand>(
    () =>
      bandFromAnchors(
        softAnchor,
        loudAnchor ?? deriveLoudFromSoft(softAnchor),
      ),
    [softAnchor, loudAnchor],
  );

  // Keep the session band in sync so the analyser (onset/offset) and the test
  // rep use the band we're building.
  useEffect(() => {
    onBandChange(workingBand);
  }, [workingBand, onBandChange]);

  // Live level loop — feeds the meter and, while holding, accumulates samples.
  const beginMonitor = useCallback(() => {
    analyser.startMonitor((rms) => {
      meterRef.current?.setLevel(rms);
      if (capturingRef.current) holdSamplesRef.current.push(rms);
    });
  }, [analyser]);

  useEffect(() => {
    if (!ready) return;
    beginMonitor();
    return () => analyser.stopMonitor();
  }, [ready, beginMonitor, analyser]);

  const handleEnableMic = useCallback(async () => {
    const ok = await analyser.requestPermission();
    if (ok) setReady(true);
  }, [analyser]);

  // ── Hold-to-capture ───────────────────────────────────────────────────
  const startHold = useCallback((which: Exclude<Capturing, null>) => {
    holdSamplesRef.current = [];
    setTestVerdict(null);
    setCapturing(which);
  }, []);

  const endHold = useCallback(() => {
    const which = capturingRef.current;
    setCapturing(null);
    if (!which) return;
    const samples = holdSamplesRef.current;
    holdSamplesRef.current = [];
    if (samples.length < MIN_HOLD_FRAMES) return; // too brief — ignore
    const value = median(samples);
    if (which === "soft") setSoftAnchor(value);
    else setLoudAnchor(value);
  }, []);

  // ── Optional test rep ─────────────────────────────────────────────────
  const handleTestRep = useCallback(() => {
    if (capturing) return;
    analyser.stopMonitor();
    setTestVerdict(null);
    setTesting(true);
    meterRef.current?.reset();
    analyser.start(
      {
        onLevel: (rms) => meterRef.current?.setLevel(rms),
        onOnset: () => meterRef.current?.setOnsetDetected(true),
      },
      (result: RepCompletion) => {
        setTesting(false);
        const { avgRMS } = result;
        const verdict =
          avgRMS < workingBand.soft
            ? "That landed too soft — lower the bottom, or coach a louder voice."
            : avgRMS >= workingBand.loud
              ? "That landed too loud — raise the top, or ease the effort."
              : "In the band — sounds well matched.";
        setTestVerdict(verdict);
        meterRef.current?.reset();
        beginMonitor();
      },
    );
  }, [analyser, capturing, workingBand, beginMonitor]);

  const stopTestRep = useCallback(() => {
    analyser.stop();
  }, [analyser]);

  const topIsDerived = loudAnchor === null;

  return (
    <div className="screen calibrate-screen">
      <button
        type="button"
        className="welcome-history-corner-link"
        onClick={onCancel}
      >
        Cancel
      </button>
      <div className="welcome-content">
        <h1>Calibrate</h1>
        <p className="subtitle">Set this patient&apos;s volume range</p>

        {!ready ? (
          <div className="button-group">
            <p className="instruction-text">
              Turn on the microphone to begin calibrating.
            </p>
            <button className="btn-primary" onClick={handleEnableMic}>
              Enable Microphone
            </button>
          </div>
        ) : (
          <>
            <p className="instruction-text">
              Hold a button while the patient sustains an &ldquo;ahhh.&rdquo; The
              meter shows where their voice lands; release to capture.
            </p>

            <div className="meter-chart-row">
              <AudioMeter ref={meterRef} band={workingBand} />
            </div>

            <div className="calibrate-anchors">
              <button
                type="button"
                className={
                  "btn-secondary calibrate-hold" +
                  (capturing === "soft" ? " is-capturing" : "")
                }
                disabled={testing}
                onPointerDown={() => startHold("soft")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
              >
                {capturing === "soft"
                  ? "Listening… release to set"
                  : "Hold: quietest acceptable (bottom)"}
              </button>

              <button
                type="button"
                className={
                  "btn-secondary calibrate-hold" +
                  (capturing === "loud" ? " is-capturing" : "")
                }
                disabled={testing}
                onPointerDown={() => startHold("loud")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
              >
                {capturing === "loud"
                  ? "Listening… release to set"
                  : "Hold: strong target (top) — optional"}
              </button>

              {!topIsDerived && (
                <button
                  type="button"
                  className="calibrate-text-link"
                  disabled={testing}
                  onClick={() => setLoudAnchor(null)}
                >
                  Use a derived top instead
                </button>
              )}
              {topIsDerived && (
                <p className="calibrate-hint">
                  Top is derived from the bottom — no need to push the patient to
                  strain.
                </p>
              )}
            </div>

            <div className="calibrate-actions">
              {!testing ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleTestRep}
                >
                  Try a test rep
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={stopTestRep}
                >
                  Stop test rep
                </button>
              )}
              {testVerdict && (
                <p className="calibrate-verdict" aria-live="polite">
                  {testVerdict}
                </p>
              )}
            </div>

            <div className="button-group">
              <button
                className="btn-primary"
                disabled={testing}
                onClick={() => onCommit(workingBand)}
              >
                Use this range &amp; start
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
