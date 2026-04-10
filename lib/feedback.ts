// ============================================================================
// SAY AH — FEEDBACK ENGINE
// Direct port of generateFeedback / determineFeedbackCategory / detection
// helpers from say_ah.html. Pure functions — no DOM, no React.
//
// The deck-deal picker (`pickUnused`) needs per-key cycling state, so it
// receives a `history` object the caller owns (typically held in a ref by
// useSession so it survives re-renders without triggering them).
// ============================================================================

import {
  METER_LOUD_THRESHOLD,
  METER_SOFT_THRESHOLD,
  STRAIN_DURATION_PERCENT,
  STRAIN_THRESHOLD,
  TARGET_DURATION_SECONDS,
} from "./constants";
import { formatSeconds } from "./format";
import type {
  FeedbackCategory,
  FeedbackHistory,
  FeedbackParams,
  FeedbackResult,
} from "./types";

// ----------------------------------------------------------------------------
// RNG helpers
// ----------------------------------------------------------------------------
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deck-deal picker: cycles through all messages in shuffled order before
// repeating any. `key` uniquely identifies the message sub-category so each
// path keeps its own deck. Exported so the real-time coach can share the
// same per-session deck pattern.
export function pickUnused(
  history: FeedbackHistory,
  key: string,
  messages: string[],
): string {
  if (!messages || messages.length === 0) return "";
  if (messages.length === 1) return messages[0];
  if (!history[key] || history[key].order.length !== messages.length) {
    history[key] = { order: shuffle(messages.map((_, i) => i)), pos: 0 };
  }
  const h = history[key];
  if (h.pos >= h.order.length) {
    h.order = shuffle(messages.map((_, i) => i));
    h.pos = 0;
  }
  return messages[h.order[h.pos++]];
}

// Name decorations — used probabilistically so the user's name doesn't appear
// in every single sentence.
function namePrefix(name: string): string {
  return name && Math.random() < 0.30 ? name + ", " : "";
}
function nameSuffix(name: string): string {
  return name && Math.random() < 0.25 ? ", " + name : "";
}

// ----------------------------------------------------------------------------
// Detection
// ----------------------------------------------------------------------------
export function detectFatigue(values: number[]): boolean {
  if (values.length < 3) return false;
  const last3 = values.slice(-3);
  return last3[1] < last3[0] * 0.9 && last3[2] < last3[1] * 0.9;
}

export function detectStrain(
  peakRMS: number,
  highAmplitudeTime: number,
  repDurationMs: number,
): boolean {
  if (repDurationMs === 0) return false;
  return (
    peakRMS > STRAIN_THRESHOLD &&
    highAmplitudeTime / repDurationMs > STRAIN_DURATION_PERCENT
  );
}

export function determineFeedbackCategory(
  duration: number,
  allDurations: number[],
  avgRMS: number,
  peakRMS: number,
  highAmplitudeTime: number,
  allLoudness: number[],
  personalBest: number,
): { category: FeedbackCategory; newPersonalBest: number } {
  const isTooSoft = avgRMS < METER_SOFT_THRESHOLD;
  const isTooLoud = avgRMS >= METER_LOUD_THRESHOLD;

  // Too loud / straining — ease up (highest priority override)
  if (isTooLoud || detectStrain(peakRMS, highAmplitudeTime, duration * 1000)) {
    return { category: "too_loud", newPersonalBest: personalBest };
  }

  // Too soft — loudness is the primary clinical goal
  if (isTooSoft) {
    return { category: "too_soft", newPersonalBest: personalBest };
  }

  // Volume is good — now evaluate duration quality
  if (duration > personalBest) {
    return { category: "personal_best", newPersonalBest: duration };
  }
  if (detectFatigue(allLoudness) || detectFatigue(allDurations)) {
    return { category: "tiring", newPersonalBest: personalBest };
  }
  if (duration >= TARGET_DURATION_SECONDS) {
    return { category: "great", newPersonalBest: personalBest };
  }
  if (duration >= TARGET_DURATION_SECONDS * 0.7) {
    return { category: "good", newPersonalBest: personalBest };
  }
  return { category: "keep_trying", newPersonalBest: personalBest };
}

// ----------------------------------------------------------------------------
// Feedback generator
// ----------------------------------------------------------------------------
export function generateFeedback(
  params: FeedbackParams,
  history: FeedbackHistory,
): FeedbackResult {
  const {
    name,
    duration,
    allDurations,
    personalBest,
    avgRMS,
    allLoudness,
    category,
  } = params;

  // `d` is the formatted "12 seconds" string (whole number + pluralized
  // unit). Templates below use `${d}` without a trailing "seconds" word.
  // `dShort` is the integer-only form for compact displays like "12s".
  const d = formatSeconds(duration);
  const dShort = Math.round(duration);
  const np = namePrefix(name);
  const ns = nameSuffix(name);

  // Duration context
  const prevDur =
    allDurations.length >= 1 ? allDurations[allDurations.length - 1] : null;
  const durDelta = prevDur !== null ? duration - prevDur : null;
  const durImproved = durDelta !== null && durDelta > 0.4;
  const durSlipped = durDelta !== null && durDelta < -0.4;
  const sessionAvg =
    allDurations.length > 0
      ? formatSeconds(
          allDurations.reduce((a, b) => a + b, 0) / allDurations.length,
        )
      : null;
  // Kept as a raw number for the < 1.5 s near-PB threshold check; never
  // rendered in message text (it used to be, but fractional gaps like
  // "0.3 seconds off" didn't read well as whole numbers).
  const distFromPB =
    personalBest > 0 ? personalBest - duration : null;

  // Loudness context
  const prevLoud =
    allLoudness.length >= 1 ? allLoudness[allLoudness.length - 1] : null;
  const loudImproved = prevLoud !== null && avgRMS > prevLoud * 1.10;
  const loudDropped = prevLoud !== null && avgRMS < prevLoud * 0.85;
  const timesTooLoud = allLoudness.filter((l) => l >= METER_LOUD_THRESHOLD).length;

  let spoken = "";
  let display = "";
  let tip: string | null = null;

  switch (category) {
    // ── LOUDNESS TOO SOFT ────────────────────────────────────────────────
    case "too_soft":
      if (loudImproved) {
        spoken = pickUnused(history, "soft.improving", [
          `${np}your voice is getting stronger — I can really hear the difference! Keep pushing for that green zone.`,
          `Great direction${ns} — your voice is coming alive. Let's go even bigger next round.`,
          `${np}that's more like it! You're finding your sound. Sustain that level all the way through next time.`,
          `${np}listen to that improvement! More of that — keep opening up.`,
          `Getting louder${ns} — that's exactly the trend we want. Push it right into the green next round.`,
        ]);
        tip = "You're getting louder — keep pushing! Sustain that volume the whole way through.";
      } else if (loudDropped) {
        spoken = pickUnused(history, "soft.dropped", [
          `${np}your voice went a little quieter that round. You've shown you can be louder — let's bring that energy back!`,
          `${d}${ns}. You were stronger before — really commit to the volume next round. Don't hold back.`,
          `${np}let's recapture that louder sound. Dig deep and give it more next round.`,
          `${np}the voice dipped a bit — next time, start louder right from the first note and hold that level.`,
          `Remember that stronger sound from before${ns}? That's the target. Really push for it.`,
        ]);
        tip = "Bring your volume back up — think big, open, confident sound.";
      } else {
        spoken = pickUnused(history, "soft.general", [
          `${np}volume is the key — imagine projecting to the back row of a theatre. Send your voice out there!`,
          `Your voice wants to come out${ns}! Open up and really let it. Don't hold back.`,
          `${np}try to surprise yourself with how loud you can be. Really commit and push it out!`,
          `${d}${ns} — now let's make that sound fill the room. More volume, more power!`,
          `${np}think of your voice as a wave — make it a big one. Open your chest and let it go.`,
          `${np}call your voice up from deep in your chest. Louder and steadier — that's what we want!`,
          `${d}${ns}. Next round: start loud and stay loud. Keep your voice right in the green zone.`,
          `${np}your voice has more in it! Open up and let it out — bolder and bigger.`,
          `Imagine hailing a taxi across a busy street${ns} — that kind of projection is exactly what we're after.`,
          `${np}give that voice some room to grow. Open wide, take a deep breath, and really go for it.`,
          `${d}${ns}. Volume is the goal — commit to projecting that sound forward from the very start.`,
          `${np}think of your voice as a spotlight. Aim it out into the room — make it fill the space!`,
          `${np}the goal is a bold, confident sound — like you really mean it. Don't whisper it, own it!`,
          `${d}${ns}. Next round, open your mouth wide and push that sound all the way to the far wall.`,
        ]);
        tip = "FOCUS ON VOLUME — louder is more important than longer right now. Go for the green!";
      }
      display = `Louder next round — aim for the green zone!`;
      break;

    // ── TOO LOUD / STRAINING ─────────────────────────────────────────────
    case "too_loud":
      if (timesTooLoud === 0) {
        spoken = pickUnused(history, "loud.first", [
          `${np}wonderful energy! Ease back just a little — think warm, confident speaking voice rather than full projection. A steady sound actually holds longer.`,
          `Great power${ns}! Soften slightly next time — a resonant, comfortable voice is exactly what we're after.`,
          `${np}lots of energy there! Dial it back just a touch. Think dinner-table conversation, not stadium announcement.`,
          `${np}that voice is ready to go! Just bring the power in a little — strong and sustained beats loud and forced.`,
        ]);
        tip = "Ease back slightly — a comfortable, sustained voice holds longer than a strained one.";
      } else {
        spoken = pickUnused(history, "loud.repeat", [
          `${np}strong and steady beats loud and strained. Find that comfortable middle — confident, not forced.`,
          `${d}${ns}. Find the sweet spot: resonant but relaxed, strong but not pushed. That's the zone.`,
          `${np}your voice will carry further when it isn't pushed. Think 'resonant and warm' — it lasts longer too.`,
          `${np}ease up slightly. A voice that's comfortable to hold is more powerful than one that's forced.`,
          `${d}${ns}. Picture a calm, assured speaker — not shouting, just clear and carrying. That's your target.`,
        ]);
        tip = "Stay in the green zone — sustained and steady beats loud and strained.";
      }
      display = `Great effort — ease back just a little next round.`;
      break;

    // ── VOLUME GOOD: PERSONAL BEST ───────────────────────────────────────
    case "personal_best":
      spoken = pickUnused(history, "pb", [
        `${np}great volume — and ${d} is a new personal best! You've never held it that long before.`,
        `A new record${ns} — ${d}, and your voice was right in the zone. Every session you're getting stronger.`,
        `${d} — that beats your previous best. Strong voice, strong effort${ns}.`,
        `${np}${d} — a new personal best! Your voice is genuinely getting stronger. That's what this is all about.`,
        `Personal best${ns} — ${d} with great volume. Remember that feeling and bring it to the next round.`,
      ]);
      display = `New personal best — ${dShort}s! 🌟`;
      break;

    // ── VOLUME GOOD: EXCELLENT DURATION ──────────────────────────────────
    case "great":
      if (durImproved && durDelta) {
        spoken = pickUnused(history, "great.improving", [
          `${np}great volume — ${d}, up from last round. Real momentum building.`,
          `${d}${ns}, and climbing. Strong voice, strong hold.`,
          `${np}listen to that — ${d} and climbing. Keep that going!`,
          `Up to ${d}${ns}, voice in the zone. That's a step in exactly the right direction.`,
        ]);
      } else if (distFromPB !== null && distFromPB < 1.5) {
        spoken = pickUnused(history, "great.nearPB", [
          `${np}voice sounding great — ${d} puts you just short of your personal best. So close!`,
          `${d}${ns}. Great volume and you're almost at your all-time best. One more push could get you there.`,
          `${np}${d} — within striking distance of your best. Same energy next round and you've got it.`,
        ]);
      } else {
        spoken = pickUnused(history, "great.general", [
          `${np}that's what we want — good strong voice, and ${d}. Really well done.`,
          `Wonderful${ns} — great volume and ${d}. You should feel good about that.`,
          `${np}voice in the zone, ${d} on the clock. Excellent round.`,
          `${d}${ns}. Strong and sustained — that's the combination we're after.`,
          `${np}${d}, voice right where it should be. That's a quality round.`,
          `Solid${ns} — ${d} and good volume throughout. Exactly the pattern we want to see.`,
          `${np}voice steady, duration strong — ${d}. That's the exercise working as it should.`,
        ]);
      }
      display = `${dShort}s — excellent!`;
      break;

    // ── VOLUME GOOD: DECENT DURATION ─────────────────────────────────────
    case "good":
      if (durImproved && durDelta) {
        spoken = pickUnused(history, "good.improving", [
          `${np}great volume — ${d}, up from before. You're finding your rhythm.`,
          `Good improvement${ns} — ${d} this time, voice in the zone.`,
          `${np}up to ${d} and your voice is in the green. That's a step forward.`,
          `${d}${ns} — and trending up. Voice sounds strong. Keep that going.`,
        ]);
      } else if (durSlipped) {
        spoken = pickUnused(history, "good.slipped", [
          `${np}volume is good — ${d} this round. Your body is doing real work; the duration will come.`,
          `${d}${ns}, voice in range. A small dip is normal — just keep going.`,
          `${np}${d} — slight dip, but your voice is still in the zone. That's what matters right now.`,
          `${d}${ns}. Small fluctuations are normal across 15 rounds. Volume's good, so you're on track.`,
        ]);
      } else {
        spoken = pickUnused(history, "good.general", [
          `${np}good strong voice — ${d}. Each round is building your endurance.`,
          `${d}${ns}, and your volume is right where we want it. Solid work.`,
          `${np}nice steady voice — ${d}. You're making real progress.`,
          `Good round${ns} — volume on target, ${d}.`,
          `${np}${d} with volume in the green. That's exactly what this exercise is for.`,
          `Consistent${ns} — voice in range, ${d}. Your voice is getting comfortable at this level.`,
          `${np}voice strong, hold solid — ${d}. That's a good round.`,
        ]);
      }
      display = `${dShort}s — good effort!`;
      break;

    // ── VOLUME GOOD: BUILDING DURATION ───────────────────────────────────
    case "keep_trying":
      if (sessionAvg) {
        spoken = pickUnused(history, "keep.avg", [
          `${np}great that your voice is in the zone. Push for a little longer next time — see if you can get past ${sessionAvg}.`,
          `${d}${ns}. Volume is on point — now stretch that hold. Take a deep breath and really commit.`,
          `${np}the voice is there, now build the hold. Next round: keep the sound going just a bit further than before.`,
          `${d}${ns} — the volume sounds good. Try to hold through any impulse to stop and squeeze out a bit more.`,
          `${np}solid volume — ${d}. Next round, dare yourself to hold past the point you normally stop.`,
        ]);
      } else {
        spoken = pickUnused(history, "keep.general", [
          `${np}voice is strong — hold it a little longer next round. Full breath and see how far you can go.`,
          `${d}${ns}. Good volume — let's stretch it further. Breathe deep and push through.`,
          `${np}you've got the right sound — now see how long you can sustain it. Hold through the urge to stop.`,
          `${d}${ns}, voice in the green. Next round: take a full breath and dare yourself to hold longer.`,
          `${np}that's the right volume — now let's work on duration. Deep breath and keep that sound going.`,
        ]);
      }
      display = `${dShort}s — keep going!`;
      tip = "Volume sounds good! Now try to hold that sound a little longer each round.";
      break;

    // ── TIRING ───────────────────────────────────────────────────────────
    case "tiring":
      spoken = pickUnused(history, "tiring", [
        `${np}your voice is working hard today — that's real effort! Take a comfortable breath before the next round.`,
        `${d}${ns}. It's natural to ease off as the session progresses. A breath and come back strong.`,
        `${np}your voice has given a lot today. Slow, easy breath before the next round — you can finish strong.`,
        `${np}the work is building up — that's the exercise doing its job. Recover a beat and go again.`,
        `${d}${ns}. Fatigue at this stage means you're pushing. Rest a moment and give the next round everything.`,
      ]);
      display = `Take a comfortable breath — you're doing great.`;
      tip = `Slow breath in, and give the next round everything you've got.`;
      break;
  }

  return { spoken, display, tip };
}

// Session-complete message (also dynamic)
export function generateSessionCompleteMessage(
  name: string,
  durations: number[],
): string {
  const avg = formatSeconds(
    durations.reduce((a, b) => a + b, 0) / durations.length,
  );
  const best = formatSeconds(Math.max(...durations));
  const np = namePrefix(name);
  return pick([
    `${np}you completed all 15 rounds. Your session average was ${avg} — that's real work.`,
    `Fifteen rounds done${name ? ", " + name : ""}. Best round today: ${best}. Your voice is getting stronger.`,
    `${np}all 15 rounds complete. Session average: ${avg}. You should feel proud of that effort.`,
  ]);
}
