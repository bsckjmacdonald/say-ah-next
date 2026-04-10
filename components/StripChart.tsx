"use client";

// ============================================================================
// StripChart — canvas-based zone-banded loudness history
//
// Two variants:
//   - Live (on the exercise screen) — small, no time axis. Updated via the
//     imperative `draw` ref each time a new 0.5 s point is committed.
//   - Final (on the result screen) — larger, with time axis. Pass the
//     completed buffer as `buffer` and let it draw on mount.
// ============================================================================

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  CHART_MAX_LEVEL,
  METER_LOUD_THRESHOLD,
  METER_SOFT_THRESHOLD,
  STRIP_MAX_POINTS,
} from "@/lib/constants";

interface RenderOpts {
  dotRadius: number;
  timeLabels: boolean;
}

function renderLoudnessChart(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  buffer: number[],
  opts: RenderOpts,
) {
  const { dotRadius, timeLabels } = opts;
  const labelH = timeLabels ? 18 : 0;
  const cH = H - labelH;

  ctx.clearRect(0, 0, W, H);

  const scl = (lvl: number) =>
    Math.min(Math.max(lvl, 0), CHART_MAX_LEVEL) / CHART_MAX_LEVEL;

  // Zone background bands
  const softFrac = scl(METER_SOFT_THRESHOLD);
  const loudFrac = scl(METER_LOUD_THRESHOLD);
  const bands = [
    {
      yFrac: 0,
      hFrac: 1 - loudFrac,
      color: "rgba(224,123,90,0.18)",
    },
    {
      yFrac: 1 - loudFrac,
      hFrac: loudFrac - softFrac,
      color: "rgba(52,199,89,0.18)",
    },
    {
      yFrac: 1 - softFrac,
      hFrac: softFrac,
      color: "rgba(244,196,52,0.18)",
    },
  ];
  bands.forEach((z) => {
    ctx.fillStyle = z.color;
    ctx.fillRect(0, cH * z.yFrac, W, cH * z.hFrac);
  });

  // Dashed zone-boundary lines
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
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
  ctx.font = `${timeLabels ? 11 : 10}px -apple-system,"SF Pro Text",Arial,sans-serif`;
  ctx.textAlign = "right";
  const labels = [
    {
      text: "quite loud",
      y: (cH * (1 - loudFrac)) / 2,
      color: "rgba(192,78,38,0.65)",
    },
    {
      text: "target",
      y: cH * (1 - (loudFrac + softFrac) / 2),
      color: "rgba(26,106,26,0.65)",
    },
    {
      text: "too soft",
      y: cH * (1 - softFrac / 2),
      color: "rgba(138,104,0,0.65)",
    },
  ];
  labels.forEach((l) => {
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, W - 5, l.y + 4);
  });
  ctx.restore();

  if (!buffer || buffer.length === 0) return;

  const xStep = W / STRIP_MAX_POINTS;
  const lvlToY = (lvl: number) => cH * (1 - scl(lvl));
  const zoneClr = (lvl: number) => {
    if (lvl < METER_SOFT_THRESHOLD) return "#c9a800";
    if (lvl < METER_LOUD_THRESHOLD) return "#1a8a3a";
    return "#c04e26";
  };

  // Filled area under the curve
  ctx.beginPath();
  ctx.moveTo(0, cH);
  buffer.forEach((lvl, i) => ctx.lineTo(i * xStep, lvlToY(lvl)));
  ctx.lineTo((buffer.length - 1) * xStep, cH);
  ctx.closePath();
  ctx.fillStyle = "rgba(42,124,124,0.13)";
  ctx.fill();

  // Line segments coloured by zone
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 1; i < buffer.length; i++) {
    ctx.beginPath();
    ctx.moveTo((i - 1) * xStep, lvlToY(buffer[i - 1]));
    ctx.lineTo(i * xStep, lvlToY(buffer[i]));
    ctx.strokeStyle = zoneClr(buffer[i]);
    ctx.stroke();
  }

  // Dots at each 0.5 s point
  buffer.forEach((lvl, i) => {
    const x = i * xStep;
    const y = lvlToY(lvl);
    const isLast = i === buffer.length - 1;
    ctx.beginPath();
    ctx.arc(x, y, isLast ? dotRadius * 1.5 : dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = zoneClr(lvl);
    ctx.fill();
    if (isLast) {
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // Time axis labels
  if (timeLabels) {
    ctx.save();
    ctx.font = '11px -apple-system,"SF Pro Text",Arial,sans-serif';
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    for (let p = 0; p < STRIP_MAX_POINTS; p += 10) {
      const x = p * xStep;
      ctx.textAlign = p === 0 ? "left" : "center";
      ctx.fillText(p / 2 + "s", p === 0 ? 2 : x, H - 3);
    }
    ctx.restore();
  }
}

// ----------------------------------------------------------------------------
// Live chart — exposes an imperative draw() handle
// ----------------------------------------------------------------------------
export interface LiveStripChartHandle {
  draw: (buffer: number[]) => void;
  reset: () => void;
}

export const LiveStripChart = forwardRef<LiveStripChartHandle>(
  function LiveStripChart(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bufferRef = useRef<number[]>([]);

    const sizeAndDraw = (buffer: number[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!canvas.width || canvas.width !== canvas.offsetWidth) {
        canvas.width = canvas.offsetWidth || 480;
        canvas.height = canvas.offsetHeight || 88;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderLoudnessChart(ctx, canvas.width, canvas.height, buffer, {
        dotRadius: 3,
        timeLabels: false,
      });
    };

    useImperativeHandle(
      ref,
      () => ({
        draw(buffer: number[]) {
          bufferRef.current = buffer;
          sizeAndDraw(buffer);
        },
        reset() {
          bufferRef.current = [];
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
        <div className="strip-chart-label">
          Loudness over time this round
        </div>
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
      dotRadius: 4.5,
      timeLabels: true,
    });
  }, [buffer]);

  return <canvas ref={canvasRef} className="result-strip-chart" />;
}
