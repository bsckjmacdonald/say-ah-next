"use client";

import type { AudioConstraintStatus } from "@/lib/types";

interface Props {
  status: AudioConstraintStatus;
}

/**
 * Shown during exercise when AGC isn't confirmed off. AGC compresses the
 * signal over time, destroying the absolute-SPL linearity the meter depends on.
 * Renders nothing when AGC is confirmed off.
 */
export function HardwareLimitedBanner({ status }: Props) {
  if (status.agc === "off") return null;

  const message =
    status.agc === "on"
      ? "Mic auto-gain is active — loudness readings may vary"
      : "Mic auto-gain status unknown — readings may vary";

  return (
    <div className="hw-limited-banner" role="status" aria-live="polite">
      {message}
    </div>
  );
}
