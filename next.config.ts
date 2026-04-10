import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static HTML/JS/CSS export. `npm run build` produces a self-contained
  // `out/` directory that can be served from any web host (Vercel, Netlify,
  // GitHub Pages, an S3 bucket, or even `npx serve out`).
  //
  // IMPORTANT: getUserMedia requires a secure origin. The exported files
  // need to be served over HTTPS or http://localhost — opening index.html
  // directly via file:// will fail to grant mic access on modern browsers.
  output: "export",
};

export default nextConfig;
