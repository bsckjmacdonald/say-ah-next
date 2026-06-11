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

## WS1 — Calibration + dB-based zones  *(core, highest value)*

**Addresses:** #1 (loudness wrong both directions), #13 (healthy high loudness
penalized), #7 personal-best bug, #7 timer overrun.

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

### 1b. Redefine zones in dB SPL
- Replace `METER_SOFT_THRESHOLD` / `METER_LOUD_THRESHOLD` (RMS fractions in
  `lib/constants.ts:40-41`) with dB-SPL target-band thresholds.
- Convert per-frame RMS → calibrated dB SPL (using the device offset) *before*
  the zone decision, in both `feedback.ts:determineFeedbackCategory` and the
  meter/strip-chart rendering path.
- Honor the clinical note: some PWP are healthy at 80–89 dB; coach "ease effort,"
  never imply shouting.

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
**Blocked on:** clinical dB-SPL target band (see Open Questions).

---

## WS2 — Kokoro TTS  *(independent, parallelizable)*

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

## WS3 — Windows desktop reliability  *(needs repro, likely quick)*

**Addresses:** #4 (no data on Windows 11, Chrome + Edge), #9 (Done/Stop button
dead), part of #3.

- **Lead hypothesis:** `getUserMedia` requests `sampleRate: 48000` and
  `channelCount: 1` as hard constraints (`hooks/useAudioAnalyser.ts:189-197`). On
  Windows devices defaulting to 44.1 kHz this throws `OverconstrainedError`;
  `openStream` catches it and returns `false` with only a `console.error`
  (line 236) — a **silent failure**. With no analyser: meter dead, onset never
  fires, Done/Stop does nothing, duration stays empty. Matches every Windows
  symptom reported.
- **Fix:** make `sampleRate` / `channelCount` advisory (`{ ideal: … }`) or drop
  them; **surface a visible error** when `openStream` fails instead of failing
  silently.
- **Verify** on a Windows profile (the `verify` skill) before/after.

**Risk:** low — high-confidence diagnosis, small change.

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

**Addresses:** #12 (don't count short / auto-discarded reps; sustained-rep
targets).

- Don't count reps below a minimum duration toward the 15; optionally extend the
  set when early reps are too short (Heather: 15 *good* sustained reps, or a total
  phonation time of 6–10 min).
- Touches `useSession` rep accounting and `constants.ts` (`TOTAL_REPS`,
  `TARGET_DURATION_SECONDS`).

**Risk:** low-medium.
**Blocked on:** clinical spec (see Open Questions).

---

## Suggested sequencing

1. **WS3 (Windows)** — low-risk, unblocks desktop testers entirely.
2. **WS1 (calibration + dB zones)** — core clinical fix; start once the target
   band is agreed.
3. **WS2 (Kokoro)** — in parallel with WS1; independent code.
4. **WS4 / WS5** — polish + clinical logic; fold in once specs land.

Pre-merge: run the `session-check` QA checklist.

---

## Open questions (need clinical input before building)

1. **dB-SPL target band (WS1b):** what are the green-zone lower and upper bounds
   in dB SPL? How is the upper bound reconciled with healthy PWP at 80–89 dB —
   wider band, or per-patient adjustable?
2. **Per-patient targets:** Heather and Beth both asked whether the SLP can set
   goals per patient. In scope for this batch, or a later clinician-setup feature?
3. **Rep-logic spec (WS5):** minimum countable rep duration; target rep-count vs.
   total-phonation-time; whether to auto-extend the set.
4. **Calibration friction:** is a bottle-whistle calibration step acceptable for
   elderly PD patients at home, or should it be clinician-run during setup only?
