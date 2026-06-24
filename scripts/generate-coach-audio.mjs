// ============================================================================
// SAY AH — coach audio generator (build-time, run in Node)
//
// Pre-generates ALL fixed coach phrases in each shortlisted Kokoro voice and
// writes them as static mp3s under public/coach/<voice>/, plus a manifest. The
// app plays these directly (fetch + decode) — instant, reliable, identical on
// laptop/phone/Safari, no model or worker needed for them:
//
//   - cues:     the in-rep cue pools (coachCues.json). Selection stays live
//               (real-time loudness logic picks WHICH cue), so it's responsive,
//               not canned. Played from a static file => always comes through.
//   - fallback: inspiring, non-personalized post-rep lines, dealt non-recycling
//               when a fresh contextual synth isn't ready.
//
// Run:  npm run gen:coach-audio   (re-run if voices/phrases change)
// ============================================================================

import { KokoroTTS } from "kokoro-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICES = ["af_heart", "af_bella", "bf_emma", "am_michael"];

const CUE_POOLS = JSON.parse(readFileSync("lib/coachCues.json", "utf8"));
const CUE_PHRASES = Object.values(CUE_POOLS).flat();

// The single fixed phrase the /setup voice step previews in each voice. Static
// (sample.mp3 per voice) so setup never has to download the model just to let a
// clinician compare voices. This is the canonical definition of the phrase.
const SAMPLE_PHRASE = "Great effort! Keep that volume up!";

// Inspiring, NON-personalized LSVT-themed post-rep lines. >16 so a full session
// never recycles one. Broadly encouraging so any one fits any rep.
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
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
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

async function renderMp3(text, voice, outPath) {
  const r = await tts.generate(text, { voice });
  const wavPath = outPath.replace(/\.mp3$/, ".tmp.wav");
  writeFileSync(wavPath, floatToWav(r.audio, r.sampling_rate ?? 24000));
  execFileSync(
    "ffmpeg",
    ["-y", "-i", wavPath, "-ac", "1", "-b:a", "64k", outPath],
    { stdio: "ignore" },
  );
  rmSync(wavPath);
}

rmSync("public/coach", { recursive: true, force: true });

const manifest = {};
for (const voice of VOICES) {
  const dir = `public/coach/${voice}`;
  mkdirSync(dir, { recursive: true });
  const cues = {};
  for (let i = 0; i < CUE_PHRASES.length; i++) {
    const file = `cue-${String(i).padStart(2, "0")}.mp3`;
    await renderMp3(CUE_PHRASES[i], voice, `${dir}/${file}`);
    cues[CUE_PHRASES[i]] = `/coach/${voice}/${file}`;
  }
  const fallback = [];
  for (let i = 0; i < FALLBACK_PHRASES.length; i++) {
    const file = `fb-${String(i).padStart(2, "0")}.mp3`;
    await renderMp3(FALLBACK_PHRASES[i], voice, `${dir}/${file}`);
    fallback.push(`/coach/${voice}/${file}`);
  }
  await renderMp3(SAMPLE_PHRASE, voice, `${dir}/sample.mp3`);
  const sample = `/coach/${voice}/sample.mp3`;
  manifest[voice] = { cues, fallback, sample };
  console.log(
    `${voice}: ${CUE_PHRASES.length} cues + ${FALLBACK_PHRASES.length} fallback + 1 sample`,
  );
}
writeFileSync("public/coach/manifest.json", JSON.stringify(manifest, null, 2));
console.log("Done. Manifest: public/coach/manifest.json");
