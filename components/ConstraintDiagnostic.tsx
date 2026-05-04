"use client";

import type { AudioConstraintStatus } from "@/lib/types";

interface Props {
  status: AudioConstraintStatus;
  deviceId: string | null;
}

function Indicator({
  label,
  value,
  goodWhenOff,
}: {
  label: string;
  value: "off" | "on" | "unknown";
  goodWhenOff: boolean;
}) {
  const dotClass =
    value === "unknown"
      ? "constraint-dot constraint-dot-neutral"
      : value === "off" === goodWhenOff
        ? "constraint-dot constraint-dot-good"
        : "constraint-dot constraint-dot-warn";

  return (
    <span className="constraint-indicator">
      <span className={dotClass} aria-hidden="true" />
      {label}: {value}
    </span>
  );
}

/**
 * Small diagnostic strip showing what the browser actually applied to the mic
 * stream. Helps verify that the audio processing constraints were honoured
 * without opening DevTools.
 */
export function ConstraintDiagnostic({ status, deviceId }: Props) {
  const shortId = deviceId ? deviceId.slice(0, 8) + "…" : "—";

  return (
    <div className="constraint-diagnostic">
      <Indicator label="AGC" value={status.agc} goodWhenOff={true} />
      <Indicator label="AEC" value={status.aec} goodWhenOff={false} />
      <Indicator label="NS" value={status.noiseSuppression} goodWhenOff={true} />
      <span className="constraint-device">device {shortId}</span>
    </div>
  );
}
