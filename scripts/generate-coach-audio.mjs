// ============================================================================
// SAY AH — coach fallback audio generator (build-time, run in Node)
//
// Pre-generates a batch of generic encouragement phrases in each shortlisted
// Kokoro voice and writes them as static WAVs under public/coach/<voice>/, plus
// a manifest. These are the RELIABLE, in-voice, non-recycling FALLBACK the app
// plays at post-rep when a fresh contextual synth isn't ready in time — so it
// never drops to the robotic browser voice, and never sounds canned (the app
// still attempts fresh, contextual lines first; these only bridge the gap).
//
// NOT all phrases are pre-generated — only this fallback batch. Run with:
//   node scripts/generate-coach-audio.mjs
// Re-run if the voice shortlist or fallback phrases change.
// ============================================================================

import { KokoroTTS } from "kokoro-js";
import { mkdirSync, writeFileSync } from "node:fs";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICES = ["af_heart", "af_bella", "bf_emma", "am_michael"];

// Inspiring, NON-personalized LSVT-themed lines (loud/strong/practice/be-heard).
// >16 so a full session (15 reps + complete) never recycles one. Broadly
// encouraging so any one fits any rep — the rep-specific detail is on screen and
// in the (attempted) fresh contextual line.
const FALLBACK_PHRASES = [
  "Every rep makes your voice a little stronger.",
  "That's the power of practice — keep it going.",
  "Your voice is a muscle, and you're building it.",
  "Loud and proud — that's what we're working toward.",
  "Speak up and be heard. You're doing the work.",
  "Strong voice, strong presence.",
  "All that effort adds up, round after round.",
  "Your voice deserves to be heard — keep it big.",
  "Big, bold, and confident — that's the goal.",
  "Fill the room with your voice.",
  "Powerful work. Your voice is waking up.",
  "This is how we keep your voice strong for life.",
  "Steady practice, stronger voice.",
  "You showed up and put in the work — that matters.",
  "Let your voice carry — there's so much in there.",
  "Keep your voice alive and powerful.",
  "Each round builds the habit of a bigger voice.",
  "Your hard work is building a stronger voice.",
  "Keep reaching for that big, clear voice.",
  "Every strong breath counts. Well done.",
];

function floatToWav(float32, sampleRate) {
  const n = float32.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits/sample
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, o);
    o += 2;
  }
  return buf;
}

const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
  dtype: "q8",
  device: "cpu",
});

const manifest = {};
for (const voice of VOICES) {
  mkdirSync(`public/coach/${voice}`, { recursive: true });
  manifest[voice] = [];
  for (let i = 0; i < FALLBACK_PHRASES.length; i++) {
    const r = await tts.generate(FALLBACK_PHRASES[i], { voice });
    const file = `fb-${String(i).padStart(2, "0")}.wav`;
    writeFileSync(
      `public/coach/${voice}/${file}`,
      floatToWav(r.audio, r.sampling_rate ?? 24000),
    );
    manifest[voice].push(`/coach/${voice}/${file}`);
    process.stdout.write(`  ${voice} ${i + 1}/${FALLBACK_PHRASES.length}\r`);
  }
  console.log(`\n${voice}: ${FALLBACK_PHRASES.length} files`);
}
writeFileSync(
  "public/coach/fallback-manifest.json",
  JSON.stringify(manifest, null, 2),
);
console.log("Done. Manifest: public/coach/fallback-manifest.json");
