import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel runs Next.js natively — no special config needed.
  //
  // For self-hosting (zip + serve from any static web host), uncomment the
  // line below to produce a static `out/` directory on `npm run build`.
  // The exported files need HTTPS or localhost for getUserMedia (mic).
  //
  // output: "export",
};

export default nextConfig;
