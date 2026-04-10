"use client";

// DurationDisplay — large running timer. Updated imperatively from the
// audio analyser loop to avoid React re-renders at 60 fps.

import { forwardRef, useImperativeHandle, useRef } from "react";

export interface DurationDisplayHandle {
  setSeconds: (seconds: number) => void;
  reset: () => void;
}

export const DurationDisplay = forwardRef<DurationDisplayHandle>(
  function DurationDisplay(_props, ref) {
    const elRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        setSeconds(seconds: number) {
          if (elRef.current) elRef.current.textContent = seconds.toFixed(1) + "s";
        },
        reset() {
          if (elRef.current) elRef.current.textContent = "0.0s";
        },
      }),
      [],
    );

    return (
      <div ref={elRef} className="duration-display">
        0.0s
      </div>
    );
  },
);
