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
// reading. The label says "SPL (est.)" to make this clear in the UI.
// ============================================================================

import { forwardRef, useImperativeHandle, useRef } from "react";
import {
  CHART_MAX_LEVEL,
  DB_SPL_DISPLAY_FLOOR,
  METER_LOUD_THRESHOLD,
  METER_SOFT_THRESHOLD,
  ZONE_COLORS,
} from "@/lib/constants";
import { rmsToDbSpl } from "@/lib/audio";

export interface AudioMeterHandle {
  setLevel: (rawLevel: number) => void;
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

export const AudioMeter = forwardRef<AudioMeterHandle>(function AudioMeter(
  _props,
  ref,
) {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const dbReadoutRef = useRef<HTMLDivElement>(null);

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

        if (level > 0.05) fill.classList.remove("pulsing");

        // ----- Bar height + zone colour -----
        const scaled = Math.min(level, CHART_MAX_LEVEL) / CHART_MAX_LEVEL;
        fill.style.height = scaled * 100 + "%";

        if (level < METER_SOFT_THRESHOLD) {
          fill.style.backgroundColor = ZONE_COLORS.soft;
        } else if (level < METER_LOUD_THRESHOLD) {
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
        const dbReadout = dbReadoutRef.current;
        if (dbReadout) {
          const db = rmsToDbSpl(level);
          const display =
            db < DB_SPL_DISPLAY_FLOOR ? null : Math.round(db);
          if (display !== lastDbDisplayRef.current) {
            lastDbDisplayRef.current = display;
            dbReadout.textContent =
              display === null ? "—" : `${display} dB`;
          }
        }
      },
      reset() {
        smoothedRef.current = 0;
        peakInputSmoothedRef.current = 0;
        peakLevelRef.current = 0;
        peakHoldUntilRef.current = 0;
        lastFrameTimeRef.current = 0;
        lastDbDisplayRef.current = null;

        const fill = fillRef.current;
        if (fill) {
          fill.style.height = "0%";
          fill.style.backgroundColor = ZONE_COLORS.target;
          fill.classList.add("pulsing");
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
      <div className="db-readout-wrapper">
        <div ref={dbReadoutRef} className="db-readout">
          —
        </div>
        <div className="db-readout-label">SPL (est.)</div>
      </div>
      <div className="meter-with-labels">
        <div className="meter-track-wrapper">
          <div className="audio-meter-track">
            <div ref={fillRef} className="audio-meter-fill pulsing" />
          </div>
          <div ref={peakRef} className="meter-peak-marker" />
          <div className="meter-tick meter-tick-high" />
          <div className="meter-tick meter-tick-low" />
        </div>
        <div className="meter-zone-labels">
          <div className="zone-label zone-loud">Quite loud</div>
          <div className="zone-label zone-target">Target range</div>
          <div className="zone-label zone-soft">Too soft</div>
        </div>
      </div>
    </div>
  );
});
