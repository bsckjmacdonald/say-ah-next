"use client";

// ============================================================================
// AudioMeter — vertical zone-aware bar with numeric dB readout and peak hold
//
// Operates in calibrated dB SPL over a fixed visible axis (METER_AXIS_MIN_DB..
// METER_AXIS_MAX_DB). The green band runs from the patient's adaptive floor
// (prop) up to the interim ceiling. The bar/colour/peak/readout update every
// animation frame via an imperative `setLevel(rms)` ref so a 60 fps React state
// setter doesn't re-render the screen.
//
// A state label under the dB number ("Listening… / +N dB to start / Recording")
// gives the patient an actionable pre-onset cue without exposing the dB SPL
// calibration caveat.
// ============================================================================

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  DB_SPL_DISPLAY_FLOOR,
  METER_AXIS_MAX_DB,
  METER_AXIS_MIN_DB,
  ONSET_THRESHOLD,
  TARGET_CEILING_DB,
  ZONE_COLORS,
} from "@/lib/constants";
import { rmsToDbSpl } from "@/lib/audio";

export interface AudioMeterHandle {
  setLevel: (rawLevel: number) => void;
  /** Flip to true once the analyser fires onset; locks the label to "Recording". */
  setOnsetDetected: (detected: boolean) => void;
  reset: () => void;
}

interface AudioMeterProps {
  /** Green-zone floor in dB SPL (adaptive, per-patient). */
  floorDb: number;
}

const AXIS_SPAN = METER_AXIS_MAX_DB - METER_AXIS_MIN_DB;

/** dB SPL → 0..1 position on the visible meter axis. */
function dbToFrac(db: number): number {
  return Math.min(1, Math.max(0, (db - METER_AXIS_MIN_DB) / AXIS_SPAN));
}

// Peak-hold tuning, in axis-fraction space: hold the highest seen level for
// 1.2 s, then decay from full scale to zero over ~2 s of silence.
const PEAK_HOLD_MS = 1200;
const PEAK_DECAY_PER_SEC = 0.5;
// Slower EMA feeding ONLY the peak tracker so a brief loud burst can't pin the
// marker to the top. alpha = 0.04 → ~400 ms time constant at 60 fps.
const PEAK_INPUT_SMOOTH_ALPHA = 0.04;

// dB SPL the patient needs to reach for the rep to start (chart onset), derived
// once from the same RMS threshold the analyser uses for onset.
const ONSET_DB_SPL = rmsToDbSpl(ONSET_THRESHOLD);

type LabelState =
  | { kind: "listening" }
  | { kind: "to_start"; gap: number }
  | { kind: "recording" };

function labelStateEqual(a: LabelState, b: LabelState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "to_start" && b.kind === "to_start") return a.gap === b.gap;
  return true;
}

export const AudioMeter = forwardRef<AudioMeterHandle, AudioMeterProps>(
  function AudioMeter({ floorDb }, ref) {
    const fillRef = useRef<HTMLDivElement>(null);
    const peakRef = useRef<HTMLDivElement>(null);
    const dbReadoutRef = useRef<HTMLDivElement>(null);
    const dbLabelRef = useRef<HTMLDivElement>(null);

    // Latest band, readable from the imperative setLevel closure.
    const bandRef = useRef({ floorDb, ceilingDb: TARGET_CEILING_DB });
    useEffect(() => {
      bandRef.current = { floorDb, ceilingDb: TARGET_CEILING_DB };
    }, [floorDb]);

    // Visual smoothing in axis-fraction space — snappy onset, gentler fall.
    const smoothedRef = useRef(0);
    const peakInputSmoothedRef = useRef(0);
    const peakLevelRef = useRef(0);
    const peakHoldUntilRef = useRef(0);
    const lastFrameTimeRef = useRef(0);
    const lastDbDisplayRef = useRef<number | null>(null);

    // Onset latch — once the analyser declares onset, the label sticks to
    // "Recording" even if the level dips mid-rep (prevents flicker).
    const onsetDetectedRef = useRef(false);
    const lastLabelStateRef = useRef<LabelState>({ kind: "listening" });

    const applyLabelState = (state: LabelState) => {
      const label = dbLabelRef.current;
      if (!label) return;
      if (labelStateEqual(lastLabelStateRef.current, state)) return;
      lastLabelStateRef.current = state;
      label.classList.remove("is-listening", "is-to-start", "is-recording");
      switch (state.kind) {
        case "listening":
          label.textContent = "Listening…";
          label.classList.add("is-listening");
          break;
        case "to_start":
          label.textContent = `+${state.gap} dB to start`;
          label.classList.add("is-to-start");
          break;
        case "recording":
          label.textContent = "Recording";
          label.classList.add("is-recording");
          break;
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        setLevel(rawLevel: number) {
          const fill = fillRef.current;
          if (!fill) return;
          const { floorDb: floor, ceilingDb: ceiling } = bandRef.current;

          // Instantaneous dB → axis fraction, then smooth in fraction space.
          const dbInstant = rmsToDbSpl(rawLevel);
          const target = dbToFrac(dbInstant);
          const alpha = target > smoothedRef.current ? 0.25 : 0.15;
          smoothedRef.current =
            smoothedRef.current * (1 - alpha) + target * alpha;
          const frac = Math.min(Math.max(smoothedRef.current, 0), 1);

          // ----- Bar height + zone colour -----
          fill.style.height = frac * 100 + "%";
          const dbSmoothed = METER_AXIS_MIN_DB + frac * AXIS_SPAN;
          if (dbSmoothed < floor) {
            fill.style.backgroundColor = ZONE_COLORS.soft;
          } else if (dbSmoothed < ceiling) {
            fill.style.backgroundColor = ZONE_COLORS.target;
          } else {
            fill.style.backgroundColor = ZONE_COLORS.loud;
          }

          // ----- Peak hold (fraction space) -----
          const now = performance.now();
          const dt = lastFrameTimeRef.current
            ? (now - lastFrameTimeRef.current) / 1000
            : 0;
          lastFrameTimeRef.current = now;

          peakInputSmoothedRef.current =
            peakInputSmoothedRef.current * (1 - PEAK_INPUT_SMOOTH_ALPHA) +
            frac * PEAK_INPUT_SMOOTH_ALPHA;
          const peakInput = Math.min(peakInputSmoothedRef.current, 1);

          if (peakInput >= peakLevelRef.current) {
            peakLevelRef.current = peakInput;
            peakHoldUntilRef.current = now + PEAK_HOLD_MS;
          } else if (now > peakHoldUntilRef.current) {
            peakLevelRef.current = Math.max(
              0,
              peakLevelRef.current - PEAK_DECAY_PER_SEC * dt,
            );
          }
          const peak = peakRef.current;
          if (peak) {
            peak.style.bottom = peakLevelRef.current * 100 + "%";
            peak.style.opacity = peakLevelRef.current > 0.01 ? "1" : "0";
          }

          // ----- Numeric dB readout -----
          const audibleEnough = dbInstant >= DB_SPL_DISPLAY_FLOOR;
          const dbReadout = dbReadoutRef.current;
          if (dbReadout) {
            const display = audibleEnough ? Math.round(dbSmoothed) : null;
            if (display !== lastDbDisplayRef.current) {
              lastDbDisplayRef.current = display;
              dbReadout.textContent = display === null ? "—" : `${display} dB`;
            }
          }

          // ----- State label under the dB number -----
          // After onset: "Recording". Before: "Listening…" while inaudible,
          // then "+N dB to start" showing the live gap to the onset threshold.
          if (onsetDetectedRef.current) {
            applyLabelState({ kind: "recording" });
          } else if (!audibleEnough) {
            applyLabelState({ kind: "listening" });
          } else {
            const gap = Math.max(1, Math.round(ONSET_DB_SPL - dbInstant));
            applyLabelState({ kind: "to_start", gap });
          }
        },
        setOnsetDetected(detected: boolean) {
          onsetDetectedRef.current = detected;
          applyLabelState(detected ? { kind: "recording" } : { kind: "listening" });
        },
        reset() {
          smoothedRef.current = 0;
          peakInputSmoothedRef.current = 0;
          peakLevelRef.current = 0;
          peakHoldUntilRef.current = 0;
          lastFrameTimeRef.current = 0;
          lastDbDisplayRef.current = null;
          onsetDetectedRef.current = false;
          // Force the next applyLabelState to write the DOM.
          lastLabelStateRef.current = { kind: "recording" };
          applyLabelState({ kind: "listening" });

          const fill = fillRef.current;
          if (fill) {
            fill.style.height = "0%";
            fill.style.backgroundColor = ZONE_COLORS.target;
          }
          const peak = peakRef.current;
          if (peak) {
            peak.style.bottom = "0%";
            peak.style.opacity = "0";
          }
          const dbReadout = dbReadoutRef.current;
          if (dbReadout) dbReadout.textContent = "—";
        },
      }),
      [],
    );

    // Zone-boundary ticks positioned at the floor and ceiling. Inline styles so
    // they track the adaptive floor (re-renders only when floorDb changes).
    const floorPct = dbToFrac(floorDb) * 100;
    const ceilingPct = dbToFrac(TARGET_CEILING_DB) * 100;

    return (
      <div className="audio-meter-wrapper">
        <div className="meter-track-wrapper">
          <div className="audio-meter-track">
            <div ref={fillRef} className="audio-meter-fill" />
          </div>
          <div ref={peakRef} className="meter-peak-marker" />
          <div
            className="meter-tick meter-tick-high"
            style={{ bottom: `${ceilingPct}%` }}
          />
          <div
            className="meter-tick meter-tick-low"
            style={{ bottom: `${floorPct}%` }}
          />
        </div>
        <div className="db-readout-badge">
          <div ref={dbReadoutRef} className="db-readout">
            —
          </div>
          <div
            ref={dbLabelRef}
            className="db-readout-label is-listening"
            aria-live="polite"
          >
            Listening…
          </div>
        </div>
      </div>
    );
  },
);
