"use client";

// ============================================================================
// AudioMeter — vertical zone-aware bar with numeric dB readout and peak hold
//
// All visual updates (bar height, bar colour, peak marker, dB readout) happen
// every animation frame, so we expose an imperative `setLevel(rms)` ref
// instead of accepting `level` as a prop. The audio analyser hook calls
// `setLevel` directly inside its rAF loop, mutating DOM via refs. A React
// state setter at 60 fps would re-render the screen on every audio frame.
//
// dB SPL caveat: see lib/constants.ts — the displayed value is an estimate
// derived from RMS + a fixed calibration offset, not a true calibrated SPL
// reading. The visible state label ("Listening… / +N dB to start / Recording")
// gives the patient an actionable cue without exposing the calibration caveat.
// ============================================================================

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  CHART_MAX_LEVEL,
  DB_SPL_DISPLAY_FLOOR,
  ZONE_COLORS,
} from "@/lib/constants";
import { DEFAULT_BAND, type TargetBand } from "@/lib/calibration";
import { rmsToDbSpl } from "@/lib/audio";

export interface AudioMeterHandle {
  setLevel: (rawLevel: number) => void;
  /** Flip to true once the analyser fires onset; locks the label to "Recording". */
  setOnsetDetected: (detected: boolean) => void;
  reset: () => void;
}

// Peak-hold tuning: hold the highest seen level for 1.2 s, then decay so the
// marker would fall from full scale to zero in ~2 s of silence.
const PEAK_HOLD_MS = 1200;
const PEAK_DECAY_PER_SEC = CHART_MAX_LEVEL * 0.5;
// Secondary EMA applied ONLY to the input that feeds the peak tracker. The
// bar fill stays snappy with the fast EMA above; the peak marker uses this
// slower one so a 100 ms loud burst doesn't yank the marker into the red.
// alpha = 0.04 → time constant ≈ 400 ms at 60 fps. A 100 ms spike passes
// through at ~22 % of its peak; a sustained 500 ms hold passes at ~71 %.
const PEAK_INPUT_SMOOTH_ALPHA = 0.04;

type LabelState =
  | { kind: "listening" }
  | { kind: "to_start"; gap: number }
  | { kind: "recording" };

function labelStateEqual(a: LabelState, b: LabelState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "to_start" && b.kind === "to_start") return a.gap === b.gap;
  return true;
}

interface AudioMeterProps {
  /** Active target band — drives zone colours and the "+N dB to start" gap. */
  band?: TargetBand;
}

export const AudioMeter = forwardRef<AudioMeterHandle, AudioMeterProps>(
  function AudioMeter({ band = DEFAULT_BAND }, ref) {
  // Latest band, readable from the imperative setLevel (which is created once
  // with [] deps and would otherwise close over a stale band). Synced via
  // effect so we never write a ref during render. Band changes only at
  // calibration boundaries, so the post-commit timing is immaterial.
  const bandRef = useRef<TargetBand>(band);
  useEffect(() => {
    bandRef.current = band;
  }, [band]);

  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const dbReadoutRef = useRef<HTMLDivElement>(null);
  const dbLabelRef = useRef<HTMLDivElement>(null);

  // Visual smoothing — asymmetric exponential moving average. Same idea as
  // the prototype: snappy onset, gentler fall, so the bar settles in ~300 ms
  // instead of holding the onset peak for a full second.
  const smoothedRef = useRef(0);

  // Slower secondary smoothing dedicated to the peak-hold tracker so brief
  // bursts can't pin the marker to red. See PEAK_INPUT_SMOOTH_ALPHA above.
  const peakInputSmoothedRef = useRef(0);

  // Peak-hold state. Tracks the highest smoothed level recently seen and
  // when it expires.
  const peakLevelRef = useRef(0);
  const peakHoldUntilRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  // Cache the last integer dB shown so we only mutate textContent when it
  // actually changes. Avoids hammering the DOM at 60 fps when the value is
  // hovering between, say, 61.4 and 61.6.
  const lastDbDisplayRef = useRef<number | null>(null);

  // Onset latch — once the analyser declares onset, the label sticks to
  // "Recording" even if the level dips back under ONSET_THRESHOLD mid-rep.
  // This prevents the badge from flickering between states during natural
  // dips in phonation.
  const onsetDetectedRef = useRef(false);

  // Cache the last label state we wrote so we only touch the DOM when the
  // patient-visible message actually changes.
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

        // ----- Smoothing -----
        const alpha = rawLevel > smoothedRef.current ? 0.25 : 0.15;
        smoothedRef.current =
          smoothedRef.current * (1 - alpha) + rawLevel * alpha;
        const level = Math.min(smoothedRef.current, 1);

        // ----- Bar height + zone colour -----
        const scaled = Math.min(level, CHART_MAX_LEVEL) / CHART_MAX_LEVEL;
        fill.style.height = scaled * 100 + "%";

        if (level < bandRef.current.soft) {
          fill.style.backgroundColor = ZONE_COLORS.soft;
        } else if (level < bandRef.current.loud) {
          fill.style.backgroundColor = ZONE_COLORS.target;
        } else {
          fill.style.backgroundColor = ZONE_COLORS.loud;
        }

        // ----- Peak hold -----
        const now = performance.now();
        const dt = lastFrameTimeRef.current
          ? (now - lastFrameTimeRef.current) / 1000
          : 0;
        lastFrameTimeRef.current = now;

        // Feed the peak tracker from the slow secondary EMA, not the snappy
        // bar value, so a brief loud burst doesn't slam the marker into red.
        peakInputSmoothedRef.current =
          peakInputSmoothedRef.current * (1 - PEAK_INPUT_SMOOTH_ALPHA) +
          level * PEAK_INPUT_SMOOTH_ALPHA;
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
          const peakScaled =
            Math.min(peakLevelRef.current, CHART_MAX_LEVEL) / CHART_MAX_LEVEL;
          peak.style.bottom = peakScaled * 100 + "%";
          peak.style.opacity = peakLevelRef.current > 0.01 ? "1" : "0";
        }

        // ----- Numeric dB readout -----
        const db = rmsToDbSpl(level);
        const audibleEnough = db >= DB_SPL_DISPLAY_FLOOR;
        const dbReadout = dbReadoutRef.current;
        if (dbReadout) {
          const display = audibleEnough ? Math.round(db) : null;
          if (display !== lastDbDisplayRef.current) {
            lastDbDisplayRef.current = display;
            dbReadout.textContent =
              display === null ? "—" : `${display} dB`;
          }
        }

        // ----- State label under the dB number -----
        // After onset: stay "Recording" no matter what the level does.
        // Before onset: "Listening…" while inaudible, then "+N dB to start"
        // showing the live gap to the chart-onset threshold.
        if (onsetDetectedRef.current) {
          applyLabelState({ kind: "recording" });
        } else if (!audibleEnough) {
          applyLabelState({ kind: "listening" });
        } else {
          const onsetDbSpl = rmsToDbSpl(bandRef.current.onset);
          const gap = Math.max(1, Math.round(onsetDbSpl - db));
          applyLabelState({ kind: "to_start", gap });
        }
      },
      setOnsetDetected(detected: boolean) {
        onsetDetectedRef.current = detected;
        if (detected) applyLabelState({ kind: "recording" });
        else applyLabelState({ kind: "listening" });
      },
      reset() {
        smoothedRef.current = 0;
        peakInputSmoothedRef.current = 0;
        peakLevelRef.current = 0;
        peakHoldUntilRef.current = 0;
        lastFrameTimeRef.current = 0;
        lastDbDisplayRef.current = null;
        onsetDetectedRef.current = false;
        // Force the next applyLabelState call to write the DOM.
        lastLabelStateRef.current = { kind: "recording" };
        applyLabelState({ kind: "listening" });

        const fill = fillRef.current;
        if (fill) {
          fill.style.height = "0%";
          fill.style.backgroundColor = ZONE_COLORS.soft;
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

  return (
    <div className="audio-meter-wrapper">
      <div className="meter-track-wrapper">
        <div className="audio-meter-track">
          <div ref={fillRef} className="audio-meter-fill" />
        </div>
        <div ref={peakRef} className="meter-peak-marker" />
        <div className="meter-tick meter-tick-high" />
        <div className="meter-tick meter-tick-low" />
      </div>
      <div className="db-readout-badge">
        <div ref={dbReadoutRef} className="db-readout">—</div>
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
});
