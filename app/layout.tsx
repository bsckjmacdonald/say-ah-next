import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Say Ah — Voice Exercise",
  description: "LSVT-style sustained-phonation voice exercise.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
