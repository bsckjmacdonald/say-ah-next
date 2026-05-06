import type { ReactNode } from "react";

// Override the global `body { overflow: hidden }` from the main app.
// This route is a standalone test page and needs normal document scrolling.
export default function TtsTestLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`html, body { overflow: auto !important; height: auto !important; }`}</style>
      {children}
    </>
  );
}
