import type { ReactNode } from "react";

// Override the global `body { overflow: hidden; height: 100svh }` from the main
// app (which is designed for fixed, non-scrolling patient screens). The setup
// flow is a standalone scrolling document. Mirrors app/tts-test/layout.tsx.
export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`html, body { overflow: auto !important; height: auto !important; }`}</style>
      {children}
    </>
  );
}
