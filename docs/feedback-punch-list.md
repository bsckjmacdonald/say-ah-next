# Say Ah — Feedback Punch List

Consolidated from user feedback received through 2026-04-16. Items are ordered
by simplicity × impact: quick wins first, then core fixes, then follow-ups, then
future work.

---

## Quick wins (high impact, low effort)

### 1. Move in-rep encouragement/prompting from voice to on-screen text

- Angela: "Rate of vocal feedback was too fast, hard to process, especially at
  same time as my voice."
- Heather: "prompt during phonation seem to be said really fast. It may be
  distracting or alarming."
- Anonymous: "Could not understand feedback during AH. Same comment about voice
  too fast and robotic."

**Fix:** stop calling TTS during rep capture. Render the same prompt text in a
large, high-contrast area on the rep screen that updates with category. Keep
TTS for the post-rep summary and session-complete screen, where Heather noted
the rate was already fine.

### 2. Remove LSVT-counterproductive prompts

- Angela quoted specifics: *"hold back any impulse to stop and instead squeeze
  out more"*, *"Dial it back. Think dinner table and not stadium announcement"*,
  *"Take a breath and come back strong"*.
- Beth: remove "take a breath" from the opening instructions — LSVT focuses
  only on loudness.
- Heather: don't imply shouting when the patient is at a healthy high end;
  cue "lower effort" instead.

**Fix:** edit `lib/realtimeFeedback.ts` and the welcome/instruction copy:

- Delete every "take a breath" reference.
- Replace stadium/dinner-table "too loud" language with "ease off a bit —
  same voice, less effort."
- Remove "hold back any impulse to stop and instead squeeze out more."

### 3. Add a rep counter to the rep screen

- Angela: "No counter for trials."
- Heather also pushed for longer sessions (see item 10).

**Fix:** show `Rep N of T` in the rep screen header. Value comes from
`useSession`.

### 4. Show mic-distance guidance on the rep screen

- Beth: "Users should know what distance to be from the microphone, as that
  will affect the loudness."

**Fix:** one line on the rep screen — *"Hold your phone about 12 in (30 cm)
from your mouth."* No settings, no illustration.

### 5. Fix viewport to avoid scrolling

- Beth (iPhone 17 Safari and Windows 11 laptop): "cannot see the full screen
  without needing to scroll up and back down."
- Heather: "I wish the page was made to fit on the screen without having to
  scroll up or down or resizing the screen."

**Fix:** constrain session screens to `100svh`, use a flex-column layout with
the graph as the flex-grow element. Collapse static instructions into a toggle.

### 6. Bump font size, darken colors, enlarge graph

- Angela: "Font too small / Colors too light / Graph too small."

**Fix:** CSS pass — raise the base font size, darken graph stroke and primary
text to WCAG AA, and let the graph consume the vertical space freed by item 5.

### 7. Recording-privacy disclosure

- Angela: "I didn't realize it was recording my voice until it gave me the
  option to play it back. I would not want my voice to be kept, without my
  consent."

**Fix:** one sentence on the mic-permission screen — *"Recordings stay on your
device and are discarded when you close the tab."* Add a "Discard recording"
button next to the playback control.

### 8. Highlight the browser mic-permission button

- Beth: "highlight the button for microphone access in red instead of yellow
  so it's more obvious what they should click" (referring to Chrome's *Allow
  while using the site*).

**Fix:** update the illustration/copy on the mic-permission screen to
accentuate the correct browser-chrome button. Color swap only.

### 9. Water-break interstitial every 5 reps

- Heather: "Consider adding a prompt about every 5 reps for a water break.
  This is helpful for vocal care."

**Fix:** after every 5th rep, show an interstitial card with a "Continue"
button. One string, one button, no flow changes.

### 10. Close with "loudness is the primary goal"

- Heather: *"Your progress will help your voice get stronger. Feeling loud
  makes it easier for others to hear and understand you."* — keep the duration
  infographic but add the verbal reminder.

**Fix:** append this line to the session-complete screen and the closing TTS.

### 11. Fix the leading-word TTS dropout ("take")

- Heather: "I think it meant to say 'Take a breath and come back strong', but
  the word 'take' was not said."

**Fix:** prepend a short silent utterance or leading `.` to each TTS call to
warm the synthesizer. Becomes moot for this specific prompt once "take a
breath" is removed (item 2), but keep as a defensive fix for other prompts.

---

## Core fixes (bigger wins, more work)

### 12. Optional per-device SPL calibration with a "Recalibrate" link

- Angela: "SPL was not accurate: Is there a plan to calibrate the device
  microphone in some way?"; "I was barely at normal loudness and it told me I
  was too loud"; "When I was quiet it told me I did good."
- Beth (iPhone 17): volume meter reading "quite loud" the entire time, even
  with a softer voice.
- Heather: "Quite LOUD throughout"; at the low-but-valid end "wasn't
  registering for the first 3 seconds"; "top dB should be over 80 dB."
- Anonymous: "Good healthy loudness is rated as too loud"; "loudness measuring
  starts too loud, then goes to too soft, but my voice stayed the same."

**Fix:** add a "Recalibrate microphone" link on the welcome screen. Running it
asks the user to say "ah" at a comfortable speaking volume for ~3 s, then
stores a per-device dB offset in `localStorage`. Default offset is 0 — everyone
benefits immediately, users with bad readings can self-correct. Not mandatory,
not repeated per session.

### 13. Derive target range from calibration; clinician override via `/clinician`

- Heather: "so long as the SLP can set the goals for each patient"; "Will the
  target range be set for each individual and how?"

**Fix:** default `targetMinDb` / `targetMaxDb` are derived from the calibration
baseline (concrete numbers to tune — starting point e.g. `baseline + 10 dB`
and `baseline + 25 dB`). Expose a hidden `/clinician` route that writes
`targetMinDb`, `targetMaxDb`, and `hyperfunctionDb` to `localStorage`. No
accounts.

### 14. Hyperfunction ceiling with a gentle cue

- Heather: "Is there a ceiling that will be placed to avoid hyperfunction?";
  "we advise to focus on their power and suggest 'lowering effort' and not
  tell or imply they are shouting."

**Fix:** when sustained dB exceeds `hyperfunctionDb` (default e.g. 95), surface
"ease off a bit — same voice, less effort" instead of the too-loud language.

### 15. Loosen the rep-end gate

- Heather: "cut me off when I was too quiet for a prolonged period."
- Anonymous: "It cut me off when I was holding a good AH."
- Heather: "at the low range of the middle section, but it wasn't registering
  for the first 3 seconds. It only started keeping count when I was in the
  middle range of the target."

**Fix:** require 1.5–2 s of sub-threshold frames before auto-ending a rep.
Also drop the start-of-rep dead zone — count every frame above the floor from
`t=0` so patients at the low end of the target don't lose their first few
seconds.

### 16. Dynamic rep-count bump for short AHs

- Heather: "will more trials be added if I have a very short ah. This may be
  important to ensuring motor practice time is optimized"; target ~15 reps /
  several minutes of cumulative phonation.

**Fix:** if cumulative phonation time is below the threshold at the end of
the scheduled reps, add reps until the threshold is met. Counter bump in
`useSession`; no UI changes beyond item 3.

### 17. End-of-session summary driven by actual per-rep tallies

- Angela: "Overall feedback at end of trial wasn't always consistent with what
  happened with the trial."

**Fix:** generate the summary by reading the per-rep category counts directly
from `useSession` state instead of a canned template.

---

## Follow-ups (non-trivial, scoped later)

### 18. Voice-activity gate (reject claps and ambient noise)

- Angela: "It didn't differentiate speech from clapping. I did an intermittent
  clapping noise and it tracked it and said that my voice was 'steady and the
  exercise was acting as it should.'"
- Anonymous: "The mic seemed to be picking up noise other than my voice."

**Fix:** gate rep capture on a simple band-energy check from
`useAudioAnalyser` — require most energy in ~200–3400 Hz and a plausible
zero-crossing rate. No ML. Start fail-closed (reject ambiguous frames) and
relax if it false-rejects real users.

### 19. Playback hard-cuts

- Heather: "When I played my voice back, there were times the playback was
  cutting out. More of a straight cut off versus a sound dampening."

**Fix:** likely `MediaRecorder` timeslice chunks not being concatenated
cleanly. Simplest path: record without a timeslice and stop once at end of
rep, yielding a single Blob per rep.

### 20. Windows 11 — no audio captured

- Beth: "I cannot get the program to capture any data (loudness or duration)
  on my laptop. I'm on Windows 11 and tried Chrome and Edge. I also tried with
  and without wired ear buds."

**Fix:** needs testing on Windows 11. First thing to try is passing
`{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }`
to `getUserMedia` — Chrome's AGC on Windows is known to zero out sustained
phonation. Log `track.getSettings()` to confirm sample rate and device.

---

## Future

### 21. Server-side TTS for a less robotic voice

- Angela: "Voice sounded very robotic."
- Beth: "is it possible to have a more human like voice? The voice
  congratulating me at the end was very robotic."
- Anonymous: "voice too fast and robotic."

**Scope:** generate prompt audio once with OpenAI `tts-1-hd` or ElevenLabs
and serve cached `.mp3` files from `/public/prompts/` keyed by prompt ID.
Requires minor infra and a small ongoing cost. Deferred — item 1 removes the
bulk of the in-rep TTS exposure, so the urgency drops once that ships.

### 22. Full LSVT expert review of the prompt library

- Angela: "Need a LSVT LOUD therapist to review feedback that will be given."

**Scope:** a systematic pass through `lib/realtimeFeedback.ts` (and any other
prompt-generating code) against LSVT principles. Out of scope for this cycle.

---

## Kept as-is (positive signal)

### 23. Name in feedback

- Heather: "I really liked my name being used in feedback."

**Guardrail:** ensure an empty/anonymous name is never spoken or rendered
literally — skip the name insertion when `name` is empty.
