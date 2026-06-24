# Say Ah — Clinician Setup Session
## Design Review Document · May 2026

---

## Purpose of this document

This document proposes a **Clinician Setup Session** — a one-time (or per-device) configuration step that a clinician runs with a patient during their first virtual session. It covers what the setup would configure, how it would flow, what would be stored, and what questions the team needs to answer before we build anything.

The goal is to collect clinical and UX input before committing to an implementation direction.

---

## The problem we are solving

The main Say Ah app is deliberately minimal — large text, one button, no settings. That's the right experience for elderly patients with Parkinson's disease, many of whom have some degree of cognitive decline. But three things currently need to be configured for the app to work well for a specific patient on a specific device:

| What | Why it matters | Current state |
|---|---|---|
| **Microphone calibration** | The raw mic signal needs a per-device offset to display accurate dB SPL values | No calibration UI exists; a fixed default offset is used |
| **Coach voice** | The voice that delivers in-rep encouragement needs to match what LSVT clinicians find effective and warm | Currently browser built-in TTS (robotic); Kokoro neural TTS evaluation is underway |
| **Coaching verbosity** | Some patients benefit from frequent cues; others find them distracting | Currently one fixed behaviour |

All three of these are decisions a clinician should make, not the patient. The patient should never need to see a settings screen.

---

## Guiding constraints

These constrain every design decision below.

1. **The patient-facing app stays exactly as it is.** No settings, no menus, no setup prompts visible to the patient.
2. **Setup is a clinical act, not a user preference.** The clinician directs it remotely; the patient cooperates (e.g., during calibration) and the clinician confirms the result via video.
3. **The primary deployment scenario is remote.** The patient is at home on their own device. The clinician is on a video call. Setup must be completable by a patient/caregiver following verbal guidance, with the clinician watching via screen share or observing through the video feed.
4. **Setup should take under 3 minutes**, including calibration. LSVT sessions are time-constrained.
5. **The app should work without setup** (fallback defaults), so that a patient can do a session before their clinician has configured the device. It just won't be optimally calibrated.
6. **Setup must survive across sessions** on the same device. The patient should not need to re-configure on every visit.

---

## What setup configures

### 1. Microphone calibration

**Goal:** compute a per-device SPL offset so the app displays readings within ±5 dB of a calibrated reference.

**Proposed method — guided trial phonation:**
The patient says "ahhh" at a comfortable, conversational volume for 5 seconds while the clinician watches a live quality indicator via screen share. The app measures the average level during that window. The clinician then selects the expected SPL from a preset menu — for example, "comfortable voice at arm's length" maps to approximately 60–65 dB SPL.

The offset is stored per device (keyed to the device's microphone ID) and applied silently on every subsequent session.

**Key open question for the team:** Does the app need **absolute** SPL accuracy (e.g., "patient is producing 72.3 dBSPL") or **relative** accuracy (e.g., "patient's volume has increased 8 dB compared to last month")? The answer changes the calibration requirement significantly:
- Relative accuracy only → trial phonation works well; we calibrate once and track change
- Absolute accuracy → trial phonation is unreliable because patients have different natural loudness; a known reference source (played from the clinician's end, or a calibration tone the patient plays on a second device) would be needed

**Secondary open question:** Is the "comfortable voice at arm's length ≈ 60–65 dBSPL" assumption valid for LSVT patients specifically? Their baseline vocal loudness may be meaningfully lower than the general population.

---

### 2. Coach voice selection

**Goal:** choose the Kokoro neural TTS voice that sounds most natural and encouraging for LSVT coaching.

**Proposed method:** The setup screen plays a short sample from each candidate voice saying a representative coaching phrase. The clinician listens through the video call and directs the patient/caregiver to select one. The chosen voice ID is stored and used for all subsequent coach cues.

**Dependency:** This step requires the TTS model evaluation (in progress at `~/Documents/Claude/LSVT/projects/lsvt_voice_test/WRITEUP.md`) to have produced a shortlist of 2–4 voices worth presenting. The clinician is choosing from pre-vetted candidates, not from all 54 Kokoro voices.

**Remote consideration:** In a virtual session, the clinician hears the voice samples through the patient's device speaker via the video call audio feed. This is a degraded listening environment. The team should consider whether voice selection should be made by the clinician based on their own direct audition (outside the session) rather than real-time comparison through a video call.

**Open question for the team:** Should the clinician pre-select the voice before the session (based on their own evaluation of the TTS samples) and simply confirm it during setup? Or is real-time selection during the setup session the right model?

---

### 3. Coaching verbosity

**Goal:** match the frequency and style of in-rep coaching cues to what works for this patient.

**Proposed presets (three options, clinician directs patient to select):**

| Preset | In-rep behaviour | Best for |
|---|---|---|
| **Minimal** | Visual cue only; no voice during the rep | Patients who find voice cues distracting or anxiety-inducing |
| **Standard** (default) | Voice cue at onset + one mid-rep prompt if volume drops | Most patients |
| **Encouraging** | Voice cue at onset + cues every 2 s + enthusiastic completion phrase | Patients who need strong positive reinforcement to sustain effort |

**Open question for the team:** Are these the right three levels? Are there other dimensions that matter — for example, cue content (encouraging vs. technical: "Keep going!" vs. "Maintain your volume!")? The team should validate or revise these presets before we build them.

---

## Proposed entry point

A separate URL path: **`/setup`**

No link to this path appears anywhere in the patient-facing app. In a remote session, the clinician shares the URL verbally or via video call chat. The patient or caregiver types it in — or the clinician can send it as a link ahead of the appointment (e.g., in a pre-session message: "Before we start, please open this link on your device").

A **QR code** displayed on the clinician's screen (pointed at the video camera) is also practical: the patient scans it with their device and lands directly on `/setup`.

**Access protection — open question for the team:**

The level of protection should match the risk: if a patient accidentally re-opens `/setup` and changes a setting, the worst outcome is an unexpected voice on the next session. Recoverable, not harmful. Given the target user (elderly, PD, remote), accidental re-discovery is low probability.

Options in ascending order of friction:
- **No protection** — `/setup` just works; simplest for the clinician to direct remotely
- **4-digit PIN** — clinician sets a PIN during first setup; reads it to the patient only when re-setup is needed
- **Session link with token** — clinician sends a one-time link that expires after setup completes; no PIN to remember

Recommendation: start with no protection during the proof-of-concept phase.

---

## Proposed screen flow

```
Clinician shares /setup URL or QR code during virtual session
    │
    ▼
Welcome screen
"Clinician Setup — takes about 2 minutes.
 Your clinician will guide you through each step."
[Begin Setup]
    │
    ▼
Step 1 of 3: Microphone check
"When your clinician says go, say 'ahhh' in your normal voice
 and hold it for 5 seconds."
[I'm ready — Start]
    → 5-second countdown → live meter + quality indicator
    → Result: Good / Marginal / Retry
[Accept] [Try again]
    │
    ▼
Step 2 of 3: Choose a voice
"Your clinician will ask you to play each one."
[Voice A ▶] [Voice B ▶] [Voice C ▶]
"Which one did your clinician choose?"
[Voice A] [Voice B] [Voice C]
    │
    ▼
Step 3 of 3: Coaching level
"Your clinician will tell you which to select."
[Quiet] [Standard] [Encouraging]
[short description of each]
[Save and finish]
    │
    ▼
Confirmation screen
"All done! You can close this and open the main app."
[Go to Say Ah]
```

**On returning visits**, setup does not re-run automatically. The stored settings are applied silently. If the clinician needs to change a setting (e.g., a new microphone, or adjusting the verbosity level after observing a few sessions), they direct the patient to `/setup` again — each step can be re-run independently, and the current values are shown.

---

## Settings persistence

All settings are stored in browser `localStorage` on the patient's device. This means:

- **Settings survive app updates** — localStorage is not cleared by a Next.js/Vercel deployment
- **Settings are device-specific** — if the patient switches devices, setup runs again
- **No account or login is required** — consistent with the current privacy model (no patient data leaves the device)

Keys that would be added:
- `sayah_calibration_offset_{deviceId}` — already implemented (Phase 2)
- `sayah_coach_voice` — voice ID string (e.g., `"af_heart"`)
- `sayah_coaching_level` — `"minimal"` | `"standard"` | `"encouraging"`
- `sayah_setup_complete` — boolean flag so the app knows setup has been done

---

## Re-calibration triggers

The app will prompt the clinician (not the patient) to re-run calibration in two situations:

1. **Microphone change** — if the browser detects that the active microphone device has changed since last calibration (the patient plugged in a headset, or the device was reset). The app already has infrastructure for this (`needsRecalibration` flag from Phase 1). The prompt would appear somewhere visible on the clinician's video feed but not confusing to the patient — likely a small indicator on the pre-rep screen.
2. **Manual request** — the clinician directs the patient to `/setup` to re-run any step.

**Open question for the team:** How should the recalibration prompt appear in a remote context? The patient sees it on their screen; the clinician sees it through the video call. Options: (a) show nothing to the patient and rely on the clinician to notice during the session; (b) show a brief message the patient can read aloud ("It says 'microphone changed'"); (c) automatically notify the clinician through a separate channel (out of scope for PoC).

---

## What this does NOT cover

- **Export of calibration data** — useful for research but not a clinical requirement today
- **Over-the-air voice updates** — if new Kokoro voices are added later, the clinician re-runs step 2; no special update mechanism needed
- **Clinician-side dashboard** — a view where the clinician can see the patient's calibration status and settings without the patient navigating to `/setup`; useful long-term, out of scope for PoC

---

## Open questions summary

| # | Question | Who should answer |
|---|---|---|
| 1 | Does the app need **absolute** SPL accuracy or **relative** (trend) accuracy? | Clinical team |
| 2 | Is "comfortable voice at arm's length ≈ 60–65 dBSPL" a valid assumption for LSVT patients? | Clinical team |
| 3 | Should voice selection happen **during** the setup session or **before** it (clinician pre-selects)? | Clinical + UX |
| 4 | Should voice selection be **per-patient** or one voice per device/clinician? | Clinical team |
| 5 | Are the three **verbosity presets** (Quiet / Standard / Encouraging) the right levels and labels? | Clinical team |
| 6 | Should coaching vary by **cue content** as well as frequency (encouraging vs. instructional phrasing)? | Clinical team |
| 7 | What level of **access protection** for `/setup` is appropriate for the remote context? | Clinical + UX |
| 8 | How should the **recalibration prompt** appear when the clinician is remote? | Clinical + UX |

---

## Visuals for team review

The following visuals accompany this document:

1. **`docs/setup-review/flow-diagram.png`** — setup session flow showing the first-visit sequence, the relationship to the main app, and re-calibration triggers
2. **`docs/setup-review/calibration-screen.png`** — wireframe of the microphone calibration step: live meter, quality indicator, and accept/retry controls
3. **`docs/setup-review/voice-selection-screen.png`** — wireframe of the voice selection step

These are low-fidelity wireframes for discussion purposes, not final designs.
