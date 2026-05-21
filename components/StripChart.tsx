"use client";

// ============================================================================
// StripChart — canvas-based zone-banded loudness history
//
// Two variants:
//   - Live (on the exercise screen) — updated via imperative `draw` ref.
//     x-axis starts at 10 s and ratchets up in 5 s steps as the rep grows.
//   - Final (on the result screen) — drawn from the completed buffer on mount.
//     Same ratcheting scale so axes match what the user saw during the rep.
// ============================================================================

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  CHART_MAX_LEVEL,
  METER_LOUD_THRESHOLD,
  METER_SOFT_THRESHOLD,
  ONSET_THRESHOLD,
  STRIP_INTERVAL_MS,
  STRIP_MAX_POINTS,
} from "@/lib/constants";

// How many x-axis points (seconds) to show. Starts at 10 s, ratchets up in
// 5 s increments once buffer grows beyond the current ceiling.
function computeVisiblePoints(n: number): number {
  return Math.min(STRIP_MAX_POINTS, Math.max(10, Math.ceil(n / 5) * 5));
}

interface RenderOpts {
  visiblePoints: number;
  timeLabels: boolean;
  /**
   * When true (live chart, pre-onset), draw a coaching overlay telling the
   * patient to get louder. The final/result chart leaves this off.
   */
  showStartCue?: boolean;
}

function renderLoudnessChart(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  buffer: number[],
  opts: RenderOpts,
) {
  const { visiblePoints, timeLabels, showStartCue } = opts;
  // cH = full canvas height — time labels are drawn inset (no reserved strip).
  const cH = H;

  ctx.clearRect(0, 0, W, H);

  const scl = (lvl: number) =>
    Math.min(Math.max(lvl, 0), CHART_MAX_LEVEL) / CHART_MAX_LEVEL;

  const softFrac = scl(METER_SOFT_THRESHOLD);
  const loudFrac = scl(METER_LOUD_THRESHOLD);

  // Zone background bands
  const bands = [
    { yFrac: 0,            hFrac: 1 - loudFrac,          color: "rgba(224,123,90,0.28)" },
    { yFrac: 1 - loudFrac, hFrac: loudFrac - softFrac,   color: "rgba(52,199,89,0.28)"  },
    { yFrac: 1 - softFrac, hFrac: softFrac,               color: "rgba(244,196,52,0.28)" },
  ];
  bands.forEach((z) => {
    ctx.fillStyle = z.color;
    ctx.fillRect(0, cH * z.yFrac, W, cH * z.hFrac);
  });

  // Dashed zone-boundary lines
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 1;
  [METER_LOUD_THRESHOLD, METER_SOFT_THRESHOLD].forEach((lvl) => {
    const y = cH * (1 - scl(lvl));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  });
  ctx.restore();

  // Zone labels (right-aligned inside chart area)
  ctx.save();
  ctx.font = '10px -apple-system,"SF Pro Text",Arial,sans-serif';
  ctx.textAlign = "right";
  const zoneLabels = [
    { text: "quite loud", y: (cH * (1 - loudFrac)) / 2,            color: "rgba(192,78,38,0.65)"  },
    { text: "target",     y: cH * (1 - (loudFrac + softFrac) / 2), color: "rgba(26,106,26,0.65)"  },
    { text: "too soft",   y: cH * (1 - softFrac / 2),              color: "rgba(138,104,0,0.65)"  },
  ];
  zoneLabels.forEach((l) => {
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, W - 5, l.y + 4);
  });
  ctx.restore();

  // Time axis labels — drawn inset at the very bottom of the canvas so they
  // don't consume height (keeping the zone bands flush to the canvas edges).
  if (timeLabels) {
    ctx.save();
    ctx.font = '10px -apple-system,"SF Pro Text",Arial,sans-serif';
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    const secPerPoint = STRIP_INTERVAL_MS / 1000;
    const xStep = W / visiblePoints;
    for (let p = 0; p <= visiblePoints; p += 5) {
      const x = p * xStep;
      const label = `${Math.round(p * secPerPoint)}s`;
      if (p === 0) {
        ctx.textAlign = "left";
        ctx.fillText(label, 2, H - 4);
      } else if (p === visiblePoints) {
        ctx.textAlign = "right";
        ctx.fillText(label, W - 2, H - 4);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(label, x, H - 4);
      }
    }
    ctx.restore();
  }

  // Chart-onset cue — dashed "start" line at ONSET_THRESHOLD plus a
  // coaching overlay shown until the rep begins. The line tells the patient
  // where the chart starts recording; the overlay nudges them to push
  // their voice up to it. Both disappear once setOnsetDetected(true) flips
  // showStartCue off, so the rep itself stays visually uncluttered.
  if (showStartCue) {
    const onsetY = cH * (1 - scl(ONSET_THRESHOLD));

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(0, 90, 180, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, onsetY);
    ctx.lineTo(W, onsetY);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = 'bold 11px -apple-system,"SF Pro Text",Arial,sans-serif';
    ctx.fillStyle = "rgba(0, 90, 180, 0.95)";
    ctx.textAlign = "left";
    ctx.fillText("start", 6, onsetY - 4);
    ctx.restore();

    if (!buffer || buffer.length === 0) {
      const textX = W / 2;
      const arrowY = onsetY + 26;
      const lineY = arrowY + 20;

      ctx.save();
      ctx.textAlign = "center";

      ctx.font = 'bold 22px -apple-system,"SF Pro Text",Arial,sans-serif';
      ctx.fillStyle = "rgba(0, 90, 180, 0.85)";
      ctx.fillText("↑", textX, arrowY);

      ctx.font = 'bold 14px -apple-system,"SF Pro Text",Arial,sans-serif';
      ctx.fillStyle = "rgba(0, 60, 130, 0.95)";
      ctx.fillText("A little louder to begin", textX, lineY);
      ctx.restore();
    }
  }

  if (!buffer || buffer.length === 0) return;

  const xStep = W / visiblePoints;
  const lvlToY = (lvl: number) => cH * (1 - scl(lvl));
  const zoneClr = (lvl: number) => {
    if (lvl < METER_SOFT_THRESHOLD) return "#a88a00";
    if (lvl < METER_LOUD_THRESHOLD) return "#157031";
    return "#a8401e";
  };

  const pts = buffer.map((lvl, i) => ({ x: i * xStep, y: lvlToY(lvl) }));
  const n = pts.length;

  // Smooth zone-coloured line — quadratic bezier through midpoints, no dots, no fill.
  ctx.lineWidth = 4.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (n === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 3, 0, Math.PI * 2);
    ctx.fillStyle = zoneClr(buffer[0]);
    ctx.fill();
  } else if (n === 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.strokeStyle = zoneClr(buffer[1]);
    ctx.stroke();
  } else {
    // First half-segment: pts[0] → midpoint(0,1)
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    ctx.strokeStyle = zoneClr(buffer[0]);
    ctx.stroke();
    // Interior segments: midpoint(i-1,i) → midpoint(i,i+1) via bezier at pts[i]
    for (let i = 1; i < n - 1; i++) {
      ctx.beginPath();
      ctx.moveTo(
        (pts[i - 1].x + pts[i].x) / 2,
        (pts[i - 1].y + pts[i].y) / 2,
      );
      ctx.quadraticCurveTo(
        pts[i].x, pts[i].y,
        (pts[i].x + pts[i + 1].x) / 2,
        (pts[i].y + pts[i + 1].y) / 2,
      );
      ctx.strokeStyle = zoneClr(buffer[i]);
      ctx.stroke();
    }
    // Last half-segment: midpoint(n-2,n-1) → pts[n-1]
    ctx.beginPath();
    ctx.moveTo(
      (pts[n - 2].x + pts[n - 1].x) / 2,
      (pts[n - 2].y + pts[n - 1].y) / 2,
    );
    ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
    ctx.strokeStyle = zoneClr(buffer[n - 1]);
    ctx.stroke();
  }
}

// ----------------------------------------------------------------------------
// Live chart — exposes an imperative draw() handle
// ----------------------------------------------------------------------------
export interface LiveStripChartHandle {
  draw: (buffer: number[]) => void;
  /** Flip to true once the analyser fires onset; clears the start overlay. */
  setOnsetDetected: (detected: boolean) => void;
  reset: () => void;
}

export const LiveStripChart = forwardRef<LiveStripChartHandle>(
  function LiveStripChart(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bufferRef = useRef<number[]>([]);
    const onsetDetectedRef = useRef(false);

    const sizeAndDraw = (buffer: number[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!canvas.width || canvas.width !== canvas.offsetWidth) {
        canvas.width = canvas.offsetWidth || 480;
        canvas.height = canvas.offsetHeight || 200;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderLoudnessChart(ctx, canvas.width, canvas.height, buffer, {
        visiblePoints: computeVisiblePoints(buffer.length),
        timeLabels: true,
        showStartCue: !onsetDetectedRef.current,
      });
    };

    useImperativeHandle(
      ref,
      () => ({
        draw(buffer: number[]) {
          bufferRef.current = buffer;
          sizeAndDraw(buffer);
        },
        setOnsetDetected(detected: boolean) {
          onsetDetectedRef.current = detected;
          sizeAndDraw(bufferRef.current);
        },
        reset() {
          bufferRef.current = [];
          onsetDetectedRef.current = false;
          sizeAndDraw([]);
        },
      }),
      [],
    );

    // Initial render after mount so the empty zone bands appear
    useEffect(() => {
      sizeAndDraw(bufferRef.current);
    }, []);

    return (
      <div className="strip-chart-wrapper">
        <canvas ref={canvasRef} className="strip-chart" />
      </div>
    );
  },
);

// ----------------------------------------------------------------------------
// Final chart — drawn from the rep snapshot
// ----------------------------------------------------------------------------
export function FinalStripChart({ buffer }: { buffer: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth || 480;
    canvas.height = canvas.offsetHeight || 140;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderLoudnessChart(ctx, canvas.width, canvas.height, buffer, {
      visiblePoints: computeVisiblePoints(buffer.length),
      timeLabels: true,
    });
  }, [buffer]);

  return <canvas ref={canvasRef} className="result-strip-chart" />;
}
