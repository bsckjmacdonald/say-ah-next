# Say Ah — Change Proposal

**Batch:** post–May 11 2026 feedback round + Kokoro TTS integration
**Authored:** 2026-06-11
**Status:** draft for review

Derived from the 8 clinician-tester submissions logged since the May 11 commit
(`Say-Ah-Feedback.csv`), cross-referenced against the current code. Companion
to the severity-ranked feedback review.

---

## 0. The discovery that shapes this batch

The loudness **zones are computed from raw RMS fractions, not dB SPL**, and they
are decoupled from the calibrated dB readout the user sees.

- `lib/feedback.ts:103-104` classifies each rep by comparing `avgRMS` against
  `METER_LOUD_THRESHOLD = 0.106` (a fraction of full scale). This is
  uncalibrated and device-dependent.
- The dB SPL figure shown to the user (`lib/audio.ts:rmsToDbSpl`, fixed offset
  90) is a **separate display value** that never feeds the zone decision.

This is the direct cause of Heather's report — *"the dB read out read at 75, but
it did not advance into the green zone."* The readout and the zone logic are two
different numbers. On a sensitive mic, a healthy voice pushes raw RMS past 0.106
and is auto-flagged "too loud," cutting the rep.

**Therefore:** building the calibration flow is necessary but not sufficient. The
offset it produces only moves the *displayed* number. The actual fix requires
**redefining the zone thresholds in dB SPL and gating the zone decision on the
calibrated value.** (Decision confirmed 2026-06-11.)

**Free win:** this also resolves the personal-best bug (Beth: PB shown as 14 s
when a 25 s rep existed). `determineFeedbackCategory` returns `too_loud`
(`feedback.ts:107`) *before* the PB check (`feedback.ts:117`), so a
misclassified-loud rep can never set a personal best. Fix the zones and the PB
bug disappears with no separate work.

---

## Scope

In scope for this batch (agreed 2026-06-11):

1. **Calibration + dB-based zones** (WS1) — core clinical fix
2. **Kokoro TTS** (WS2)
3. **Windows desktop reliability** (WS3)
4. **UX polish** (WS4)
5. **Clinical rep-logic** (WS5)

Deferred (broad audio-lifecycle rework): onset lag (#6), premature mid-rep
cut-off (#2), gap/restart detection (#8). **Exception:** the timer-overrun fix
(#7) is folded into WS1 per decision 2026-06-11.

---

## WS1 — Calibration + adaptive, baseline-anchored dB-SPL zones  ✅ BUILT (PR #7)

**Addresses:** #1 (loudness wrong both directions), #13 (healthy high loudness
penalized), #7 personal-best bug, #7 timer overrun.

**Design resolved 2026-06** from clinician input — see
`project_clinical_loudness_model` memory. The zone is adaptive and
personalized, not a fixed band.

### 1a. Build the calibration screen
Per the locked SPL design (see `project_spl_decisions` memory and
`SPL-Metrology-Handoff.md`):
- **Simple (default):** bottle-whistle hold ~5 s at a fixed, visually-guided
  distance; offset = `92.8 − mean_dBFS`; show a quality grade.
- **Advanced (option):** full bottle-whistle sweep with manual distance slider;
  reports offset, σ, slope, R²; three-stage breath rejection.
- Store per-device via existing `saveDeviceOffset` / `loadDeviceOffset`
  (`lib/storage.ts:63-73`), keyed by `deviceId`.

Infrastructure already present: `deviceId`, `needsRecalibration`,
`dismissRecalibration` exposed from `useAudioAnalyser`; `DEVICE_OFFSET_KEY_PREFIX`
in constants. **Not yet present:** any calibration screen or state-machine node.
Scaffold via the `new-screen` skill.

### 1b. Adaptive, baseline-anchored green zone (dB SPL)
The target zone is **not** a fixed band. Loudness is the primary goal ("long and
soft is no good"); the zone is personalized and adaptive:

- **Floor = the patient's baseline loudness, preset by the clinician during
  setup** (decision: clinician presets it). If they start at 65 dB, 65 is the
  bottom of green. Fallback: auto-measure the baseline from the first reps when a
  device was never configured (unsupervised home use).
- **Floor ratchets UP automatically** as the patient improves (decision:
  auto-adapt with clinician override). Conservative and always reinforcing —
  never lower the floor mid-session, never discourage.
- **Ceiling (interim): a provisional absolute amplitude ceiling ≈ 85 dB SPL**
  (calibrated); healthy sustained target ≈ 78–80 dB. An amplitude ceiling cannot
  distinguish healthy-loud from hyperfunction — that is the **F0 fast-follow**
  (see below). Until it lands, keep the ceiling deliberately permissive so
  healthy 80–85 dB voices are **not** flagged "too loud".
- **Implementation:** replace `METER_SOFT_THRESHOLD` / `METER_LOUD_THRESHOLD`
  (RMS fractions, `lib/constants.ts:40-41`) with calibrated dB-SPL thresholds;
  the floor becomes per-patient persisted state (per-device) rather than a
  constant. Convert per-frame RMS → calibrated dB SPL *before* the zone decision
  in both `feedback.ts:determineFeedbackCategory` and the meter/strip-chart path.
- **Clinician override:** preset band + baseline are editable via the clinician
  setup flow (ties into `CLINICIAN-SETUP-REVIEW.md` / `docs/setup-review/`).

### 1c. Wire the stored offset into the live path
`DB_SPL_CALIBRATION_OFFSET` is currently a static constant and `loadDeviceOffset`
is never read by the audio hook. Thread the calibrated per-device offset through
`useAudioAnalyser` / `audio.ts` so the live signal uses it.

### 1d. Timer overrun fix (folded in)
`finishRep` computes `duration = (now − onsetTime)` at the moment the offset-hold
expires, which includes the 1.5 s `OFFSET_HOLD_MS` of trailing silence
(`hooks/useAudioAnalyser.ts:404`). Subtract the hold window
(`offsetStartTime − onsetTime`) so the reported duration ends when the voice
actually stopped. ~2 lines. Fixes the "timer keeps going 2–3 s after I stopped"
that frustrated a real patient (May 14 session).

**Risk:** medium-high — most clinically sensitive path.
**Status:** design resolved (clinician input 2026-06); ready to build. The F0
hyperfunction ceiling is split out to a fast-follow PR (see below).

---

## WS2 — Kokoro TTS  ✅ BUILT (PR #7)

**Addresses:** #5 (robotic / rushed / jarring coach voice), part of #3 (no audio
on iOS Chrome).

- `kokoro-js@1.2.1` is already a dependency; `/tts-test` page exists; `lib/tts.ts`
  is still Web Speech only (the old Kokoro path was stripped). Build the
  `CoachVoice` service module (Phase 3 of the TTS game plan).
- **Read the selected voice ID from the WRITEUP first**
  (`~/Documents/Claude/LSVT/projects/lsvt_voice_test/WRITEUP.md`) before wiring.
- **"Rushed / clipped" root cause:** `speakMessage` calls
  `speechSynthesis.cancel()` on every cue (`lib/tts.ts:47`), so each real-time
  cue cuts off the previous one mid-word. Kokoro + **pre-synthesizing cues during
  the countdown** removes both the robotic timbre and the clipping.
- **iOS Chrome silent coach (#3):** Web Speech `speechSynthesis` is unreliable in
  iOS Chrome (CriOS) — the cause of the May 13 tester getting no audio despite the
  toggle being on. Kokoro runs via Web Audio / ONNX and sidesteps it.
- **"Jarring sudden voice":** add a short spoken intro / earcon when the coach
  engages, so it isn't a cold start mid-rep.
- Keep behind the existing coach toggle; retain Web Speech as a fallback for
  devices where Kokoro load is too slow.

**Risk:** medium — model load time on older devices; mitigate with pre-synthesis
+ warm cache (Phase 2 of game plan).

---

## WS3 — Windows desktop reliability  ✅ DONE (PR #6)

**Addresses:** #4 (no data on Windows 11, Chrome + Edge), #9 (Done/Stop button
dead), part of #3.
**Branch:** `fix/windows-audio-capture` — must be carried into the combined
batch branch (see "Branching" below) so this fix ships with the batch.

- **Confirmed root cause (NOT the original constraint hypothesis):** `openStream`
  only resumed the AudioContext on the *reuse* branch, so a freshly-created
  context (the first session) was never resumed. Chrome's autoplay policy on
  Windows routinely leaves a new `AudioContext` in the `suspended` state, which
  outputs **only silence** — the analyser reads zeros, onset never fires, the
  meter/timer never move ("no data captured"), and `stop()` silently re-arms
  because no onset was detected (Done/Stop looks broken). This explains every
  Windows symptom and why phones were unaffected. A-weighting was ruled out (the
  reports predate it; coefficients derive from the live sample rate).
- **Fix shipped:**
  1. Resume the AudioContext unconditionally once the mic stream is open
     (covers both first-create and reuse).
  2. Added an `OverconstrainedError` fallback as belt-and-suspenders — retry
     `getUserMedia` without the explicit `sampleRate`/`channelCount` so a device
     that rejects them still captures. A genuine `NotAllowedError` is re-thrown
     and still surfaces as "blocked".
- **Status:** compiles + `next build` clean; no regression on Mac/iOS. **Still
  needs runtime confirmation on a real Windows 11 machine** (Chrome + Edge).

**Risk:** low — small, isolated change.

---

## WS4 — UX polish

**Addresses:** #11 (text overwhelm on mic-permission, 2★), target-zone
legibility, #10 (playback artifact).

- Trim `MicPermissionScreen` text density; reposition instructions (clinician:
  elderly PD users get overwhelmed).
- Larger / bolder target-zone labels (Beth).
- **#10 playback "high-pitched metallic" sound** — needs reproduction; likely a
  `MediaRecorder` mimeType / sample-rate issue. Flag as **investigate**, not a
  committed fix in this batch.

**Risk:** low (text/legibility); playback artifact unknown until reproduced.

---

## WS5 — Clinical rep-logic

**Addresses:** #12 (don't count unhealthy reps; loudness-gated counting).

**Design resolved 2026-06** (clinician input — see
`project_clinical_loudness_model`). Counting is **loudness-gated, not
duration-gated**:

- A rep **counts toward the 15 if it achieved adequate loudness (in the green
  zone)** — regardless of length. A 2 s rep from a severe patient counts if it
  was loud enough. There is **no fixed minimum duration**.
- Reps auto-discarded as **unhealthy** (too quiet / cut off) do **not** count.
- Default session target stays **15 reps**, but adaptive: lean toward *more* reps
  when they're short, *fewer* when very long. (Not a fixed total-duration goal —
  per-rep duration legitimately ranges 2 s to 20+ s.)
- Touches `useSession` rep accounting and `constants.ts` (`TOTAL_REPS`); the
  count increments on loudness-qualifying reps rather than every completed rep.

**Risk:** low-medium.
**Status:** design resolved; ready to build.

---

## Suggested sequencing

1. **WS3 (Windows)** — ✅ done (PR #6).
2. **WS1 (calibration + adaptive dB-SPL zones)** — ✅ built (PR #7, with /setup).
3. **WS2 (Kokoro)** — ✅ built (PR #7).
4. **WS4 / WS5** — polish + clinical logic; design resolved, not yet built.
5. **Fast-follow (post-batch): F0 hyperfunction ceiling** — separate PR.

PR #7 bundles WS3 + WS1 + WS2 (branch `feat/feedback-batch-2026-06`, based on
the WS3 branch). Needs runtime QA (`session-check`) on real devices.

Pre-merge: run the `session-check` QA checklist.

## Fast-follow (post-batch) — F0 hyperfunction ceiling

Deferred from this batch (decision 2026-06). Replaces the interim amplitude
ceiling with a pitch-informed one so healthy-loud is never flagged as
hyperfunction:
- Add **YIN** pitch detection: a dedicated ~2048-sample time-domain buffer
  alongside the existing RMS path in `useAudioAnalyser`; run the pitch pass at
  ~20–30 Hz (not every frame).
- Capture the patient's **comfortable-baseline F0** during clinician setup (same
  step that presets the loudness band).
- Heuristic: loud **and** F0 risen a couple of semitones above baseline (and/or
  unstable) → soft "ease the effort — same voice" cue. Loud **and** F0 near
  baseline → healthy, stays green. Conservative, clinician-overridable, framed as
  a soft cue (proxy, not a diagnosis).

## Branching (so WS3 ships with the batch)

The WS3 fix is committed on `fix/windows-audio-capture` (off `main`), not on
`main`. **The combined batch branch for the remaining workstreams must include
that commit** — otherwise the batch PR won't contain the Windows fix. Either:
- merge PR #6 to `main` first, then branch the batch off `main`; **or**
- base the batch branch directly on `fix/windows-audio-capture` (cherry-pick /
  merge the WS3 commit in if it lands separately).

Verify the WS3 commit (`8e05b76`, "Fix silent no-audio capture on Windows") is
present in the batch branch before opening the batch PR.

---

## Open questions — RESOLVED 2026-06 (clinician input)

1. **dB-SPL target band (WS1b):** ✅ Not a fixed band. Floor = patient baseline,
   clinician-preset, auto-ratchets up; ceiling interim ≈ 85 dB (healthy ~78–80),
   with F0 hyperfunction discrimination as a fast-follow. See WS1b.
2. **Per-patient targets:** ✅ Yes — clinician presets per patient during setup,
   auto-adapts at home with clinician override. Folded into WS1b + clinician
   setup flow.
3. **Rep-logic spec (WS5):** ✅ Loudness-gated, not duration-gated; no fixed
   minimum duration; short loud reps count; unhealthy reps don't; default 15
   reps, adaptive. See WS5.

4. **Calibration friction:** ✅ Confirmed (2026-06) — mic calibration is
   clinician-run during /setup; bottle-whistle optional, the clinician judges
   loudness and sets the offset (built that way). Home re-calibration on
   `devicechange` remains a later refinement.
