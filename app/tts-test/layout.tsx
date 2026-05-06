import type { ReactNode } from "react";

// Isolated layout so globals.css `body { overflow: hidden }` doesn't
// block scrolling on this standalone test page.
export default function TtsTestLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        background: "#fff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
