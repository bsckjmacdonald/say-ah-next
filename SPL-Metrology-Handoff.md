# SPL Metrology Web App — Hand-Off

## 1. Objective

A browser-based **calibrated absolute Sound Pressure Level (SPL) meter** for voice
measurement. Targets clinical and field use where a Class 1 SLM is unavailable,
with the goal of producing readings within ±2 dB of a true SLM under cooperative
conditions.

Three things distinguish this from a typical "meter widget":

1. **Absolute, not relative.** dBFS → dBSPL conversion via a calibrated offset.
2. **Distance-corrected.** Mouth-to-mic distance is estimated continuously from
   webcam face geometry; readings are normalized to a clinical 30 cm reference
   via the inverse-square law.
3. **Self-calibrating.** A "bottle whistle" (330 ml glass bottle, ~92.8 dB SPL
   at 50 cm) provides a stable reference acoustic source the user already owns,
   eliminating the need for a Class 1 calibrator.

## 2. System Architecture

```
src/
├── audio/                              calibrated SPL engine (no React deps)
│   ├── splEngine.ts                    EventTarget façade; mic + worklet lifecycle
│   ├── splWorklet.js (in /public)      audio-thread RMS + peak + clipping
│   ├── aWeighting.ts                   IEC 61672-1 biquad cascade
│   ├── types.ts
│   └── index.ts
├── distance/                           camera-based distance estimation
│   ├── faceTracker.ts                  MediaPipe FaceLandmarker wrapper
│   ├── correction.ts                   pure-math: IPD → cm, dB correction
│   ├── types.ts
│   └── index.ts
├── calibration/                        bottle-whistle math
│   ├── bottleWhistle.ts                outlier rejection, binning, fit
│   └── bottleWhistle.test.ts
└── app/                                Next.js 16 App Router UI
    ├── page.tsx
    ├── _components/                    SplMeter, Thermometer, Stripchart,
    │                                   AutoCalibration, chartLayout
    └── _hooks/                         useSplEngine, useFaceDistance,
                                        useMovingAverage, useStripchartHistory,
                                        useBottleWhistleRecorder
```

The audio and distance modules are **deliberately framework-free**. Each is an
EventTarget that emits `frame` / `status` / `error` / `lost` events. The UI
layer holds the only React-specific code.

Production stack: Next.js 16 (App Router) + React 19 + TypeScript 6 +
Tailwind v4 + Vitest. MediaPipe Tasks Vision for face landmarks.

---

## 3. Audio Pipeline

### 3.1 The four mandatory DSP steps

These are non-negotiable for metrological integrity:

1. **Raw acquisition** — disable browser audio enhancements
2. **A-weighting** — IEC 61672-1 frequency response
3. **FAST time weighting** — IEC 61672 τ=125 ms exponential mean-square
4. **dBFS → dBSPL via calibrated offset**

### 3.2 Disabling browser-level enhancements (the hardest part)

Web browsers apply Auto Gain Control, echo cancellation, and noise suppression
by default. **Each one destroys absolute-SPL linearity.** The constraints object
is the first line of defense, but every step must be verified — browsers silently
ignore constraints they don't honor.

```ts
const constraints = {
  audio: {
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
    channelCount: 1,
    sampleRate: 48000,
  },
};
```

After acquisition, **always** verify what the browser actually delivered:

```ts
const settings = track.getSettings();
this.agc =
  settings.autoGainControl === false ? 'off'
  : settings.autoGainControl === true ? 'on'
  : 'unknown';
```

The engine surfaces `agc` in its status; the UI shows a "Hardware Limited"
banner when it isn't confirmed off. Don't refuse to operate — show the user the
caveat and let them decide.

### 3.3 The audio-thread worklet

`public/splWorklet.js` runs on the audio thread (no GC pressure on the UI
thread, no jitter from rAF). It does three things per audio frame:

```js
// Single-pole exponential mean-square — IEC 61672 FAST
ms += alpha * (x*x - ms);
peak = max(peak, |x|);
frameCounter++;
if (frameCounter >= framesPerPost) postMessage({rms, dbFS, peakDbFS, clipping});
```

`alpha = 1 - exp(-T/τ)` with T = 1/sampleRate and τ = 0.125 s for FAST. The
worklet posts at ~20 Hz (every 50 ms) — the smoothing handles per-sample
variability, the post rate handles UI smoothness.

### 3.4 A-weighting

`src/audio/aWeighting.ts` derives a 3-section biquad cascade from the analog
A-weighting transfer function via bilinear transform, normalized to 0 dB at
1 kHz at the actual sample rate. Tested against IEC 61672-1 reference values
across 10 Hz – 10 kHz; tighter tolerances near 1 kHz, looser at the band edges
where bilinear warping dominates.

A-weighting is implemented as a chain of `IIRFilterNode`s in the audio graph
(source → A-weighting → worklet) so the worklet never sees flat-spectrum
samples — it only sees A-weighted ones.

### 3.5 dBFS → dBSPL

```
SPL = dBFS + offsetDb
```

The default offset is **120**, derived from the typical MEMS sensitivity
(94 dB SPL @ 1 kHz ≈ −26 dBFS). Real devices vary by ±5 to ±10 dB; calibration
is mandatory for any quantitative claim.

---

## 4. Distance Estimation

### 4.1 The geometry

Pinhole camera; interpupillary distance (IPD) is the reference length:

```
d_camera_cm = (focalLengthPx × IPD_cm) / IPD_pixels
```

- **Reference IPD**: 6.3 cm (adult mean; range 5.4–7.4 cm). User-configurable.
- **Focal length**: derived from frame width and assumed FOV
  (`f = (W/2) / tan(FOV/2)`, default 60° webcam horizontal FOV).
- **IPD in pixels**: Euclidean distance between iris-center landmarks scaled
  to frame dimensions.

The default focal length estimate is the largest source of systematic error.
Future work: a one-shot focal-length calibration step where the user holds
their face at a tape-measured distance.

### 4.2 MediaPipe FaceLandmarker

We use `@mediapipe/tasks-vision` (the modern Tasks API, not the deprecated
solutions API). The model `face_landmarker.task` returns 478 landmarks
including iris detection; left iris center is index 468, right is 473.

`src/distance/faceTracker.ts` wraps the landmarker with:

- **Lazy dynamic import** so MediaPipe (~3 MB WASM + 3 MB model) doesn't
  bloat the SSR / initial bundle.
- **Delegate fallback chain** (see §7.1): tries GPU, falls back to CPU.
- **`requestVideoFrameCallback`** when available (Chrome/Safari); falls back
  to `requestAnimationFrame` elsewhere.
- **7-sample rolling median** smoothing on the distance output to suppress
  per-frame jitter.
- **Fail-fast** behavior: 3 consecutive `detectForVideo` failures and the
  tracker shuts down with an actionable error message.

### 4.3 Inverse-square distance correction

```
L_at_30cm = L_at_d + 20·log10(d / 30cm)
```

Doubling distance drops apparent SPL by ~6 dB; halving it raises by ~6 dB. Pure
geometry — implemented in `src/distance/correction.ts` with full test coverage.

### 4.4 Manual fallback

Camera-based distance is optional. If MediaPipe is unavailable (no webcam,
WebGL broken, hostile environment), the user can switch to "manual" mode —
a slider + numeric input for tape-measured distance. The correction math is
identical; only the source of the distance changes. This kept the app
**fully functional** during the WebGL incident described in §7.1.

---

## 5. Bottle-Whistle Auto-Calibration

### 5.1 The reference source

A steady whistle across the top of a 330 ml Vichy-shape glass bottle produces
**92.8 dB SPL ± 1.6 dB at 50 cm** under controlled conditions. This is based on 
web research for consumer-friendly SPL calibration. The bottle is acoustically
stable (the resonance is geometric, not material-dependent), is in every
household, and produces a tone in the perceptually sensitive vocal range.

### 5.2 Fitting strategy

Rather than asking the user to hold a single distance precisely, we ask them
to **sweep** distance while whistling — 15 cm to 90 cm and back over ~20 s.
Every audio frame gets paired with the current camera-distance estimate to
form a `{distance, dBFS}` sample.

Under inverse-square law, all samples should sit on a line in
(log₁₀(distance), dBFS) space with slope −20 dB/decade. The intercept of that
line determines the calibration offset:

```
expected_SPL(d) = 92.8 − 20·log10(d / 50cm)
implied_offset(sample) = expected_SPL(distance) − dBFS
```

If the recording is clean, all `implied_offset` values are tightly clustered;
their mean is the suggested calibration offset, and their standard deviation
(σ) is the headline quality metric.

### 5.3 The four reported quality metrics

After fitting:

| Metric | Meaning | Healthy range |
|---|---|---|
| **Suggested offset** | Mean of per-bin implied offsets | 110–135 dB for typical hardware |
| **Scatter (σ)** | StDev of per-bin implied offsets | < 1.5 dB excellent, > 3 dB poor |
| **Slope** | Regression slope of dBFS vs log₁₀(d) | −20 ± 3 dB/decade |
| **R²** | Goodness of fit | > 0.95 healthy |

The quality grade (excellent / good / fair / poor) collapses these into a
single tier the user can act on.

---

## 6. Data Quality: The Breath-Gap Problem

This is the deepest pitfall in the system, and the one we burned the most
debugging time on. **It deserves its own section.**

### 6.1 The phenomenon

A user cannot hold a continuous whistle for 20 seconds straight. They will
pause for breath. During those pauses, dBFS drops 30–45 dB to ambient noise
floor, then jumps back up when whistling resumes. If those drop samples are
allowed into the fit, they pull the intercept downward and produce nonsense
calibration offsets (e.g., 146 dB instead of 128 dB) and slopes (e.g.,
−193 dB/decade instead of −20).

### 6.2 The three-stage rejection pipeline

We catch breath samples at three independent stages. **Each stage exists
because the previous one demonstrably failed in field testing.**

**Stage 1 — Live time-window MAX gate** (in `useBottleWhistleRecorder.ts`)

Buffer holds the last **3 seconds** of accepted samples (timestamped, time-based
window). Threshold = `max(buffer) − 18 dB`. Any incoming sample below the
threshold is rejected. Headroom of 18 dB is wide enough to permit a full
sweep range (~15 dB drop) plus whistle dynamics, narrow enough to catch the
30+ dB breath gaps.

The MAX (vs. median or per-frame drop) is critical — see §7.5 for why.

**Stage 2 — Cross-bin breath rejection** (in `bottleWhistle.ts`)

The live gate can't catch every breath. When the user pauses to breathe at the
extremes of their sweep (typical motor pattern!), entire distance bins can
become breath-dominated. The bin median *is* the breath level, so per-bin
trimming is useless against this.

The fix:
1. Compute every sample's "implied intercept" assuming slope = −20:
   `intercept = dBFS + 20·log10(d / 50cm)`
2. Histogram the intercepts in 2 dB bins
3. Walk the histogram from **high dB downward**, find the first cluster with
   ≥ 5% of samples — that's the whistle level. (Whistle is always *louder*
   than breath; breath always sits at lower intercept.)
4. Reject samples whose intercept is more than 12 dB below the whistle cluster

This works even when breath samples *outnumber* whistle samples in the dataset.
There's a unit test that locks this behavior in against synthetic
breath-poisoned data sized to match a real-world failure case.

**Stage 3 — Per-bin median trim** (in `binSamples`)

After the cross-bin rejection, samples are grouped into 10 cm distance bins.
Within each bin, samples > 8 dB below the bin's own median are dropped before
computing the bin's representative dBFS. This is a final safety net for
within-bin variability.

### 6.3 Live diagnostics for trust

A real-time diagnostic block during recording shows the user:

- `latest dBFS` (turns amber when the gate just rejected)
- `last accepted` (the last value that passed)
- `window max (3 s)` (the gate's anchor)
- `gate threshold` (`max − 18 dB`)

When users report "no rejections", we ask them to screenshot this block plus
the stripchart. The four numbers tell us instantly whether the gate is failing
to fire (numbers don't make sense) or the dBFS isn't actually dropping
(audio engine issue). This pattern saved a debug round-trip multiple times.

### 6.4 The post-fit accounting

After a fit, the UI breaks down rejections:

```
2470 fit · 1554 rejected
↳ 0 live · 1142 breath · 412 bin trim
```

Showing all three stages independently makes it diagnosable when one stage is
silently failing. **Don't aggregate counts in user-facing reporting.**

---

## 7. Cross-Platform Considerations

### 7.1 The WebGL / MediaPipe minefield (most painful lesson)

MediaPipe Tasks Vision uses WebGL for its **input image pipeline** even when
the inference delegate is set to `CPU`. This is undocumented and unintuitive.
A user without a working WebGL context will see:

1. First: `emscripten_webgl_create_context() returned error 0` — GPU init fails
2. Then: `Cannot read properties of undefined (reading 'activeTexture')` — image
   pipeline tries to use the broken context
3. Then: `memory access out of bounds` — WASM heap corruption

The fix has three layers:

**Layer 1**: Try GPU delegate, catch the failure, retry with CPU. This handles
the common case where GPU init throws cleanly.

**Layer 2**: Pre-probe WebGL availability before even trying GPU. Some
environments allow context creation but fail on the first GL call. The probe
creates a canvas, requests `webgl2`/`webgl`/`experimental-webgl`, releases the
context via `WEBGL_lose_context`, and only proceeds to GPU if all of that
succeeds. If WebGL is unavailable, AUTO mode goes straight to CPU and skips
the noisy emscripten error.

**Layer 3**: Fail-fast in the per-frame loop. If `detectForVideo` throws three
consecutive times, the tracker shuts down with an actionable error:

> *Face tracking failed: this browser does not have a working WebGL context.
> Enable hardware acceleration in your browser settings, or use Manual
> distance mode.*

The manual distance fallback (§4.4) is the ultimate safety net here.

### 7.2 iOS Safari

Two specific quirks:

- **Audio output rerouting**: when the mic is active, iOS reroutes output to
  the earpiece (receiver) by default, which is useless for any feedback UI.
  The fix: `navigator.audioSession.type = 'play-and-record'`. This API is
  iOS-only; wrap in a try/catch with a no-op fallback.
- **Hidden AGC**: iOS sometimes applies AGC even when the constraint says
  `false`. `track.getSettings().autoGainControl` may return `undefined`
  rather than `false`, which is why we treat the AGC status as a tri-state
  (`'off'` / `'on'` / `'unknown'`) and warn the user when it isn't
  confirmed off.
- **No `setSinkId`**: can't redirect output to a specific device.

iPhones and iPads have unusually consistent mic sensitivity (~±2 dB across
generations), so once calibrated, the calibration is portable across iOS
devices in a way it isn't on Android.

### 7.3 Windows / Chrome

Windows applies system-level "Audio Enhancements" via APOs (Loudness
Equalization, etc.) that AGC-disable in `getUserMedia` cannot override.
The signal will appear non-linear during calibration (slope far from
−20 dB/decade). Currently we don't auto-detect this — we rely on the slope
quality metric in the calibration UI to flag it. Future work: on a poor
slope, prompt the user to run `mmsys.cpl` and check "Disable all enhancements".

### 7.4 Android

Sensitivity variance across Android handsets is huge: ±5 to ±10 dB. A single
calibration is **not portable** across Android devices. The system handles
this by exposing a per-device offset and listening for `devicechange` events
(e.g., headset plugged in) to prompt re-calibration. Future work: persist
offsets keyed by `MediaStreamTrack.getSettings().deviceId` in localStorage so
the user doesn't have to recalibrate the same hardware twice.

### 7.5 Browser engine smoothing — the silent killer

This caused the deepest debugging session of the project. Documented separately
in §8.

---

## 8. Lessons Learned (root causes + remedies)

### 8.1 The IEC FAST smoothing broke the live breath gate

**Symptom**: User takes obvious 40+ dB breath gaps (visible in the stripchart),
"Breath gaps" counter stays at 0.

**Diagnosis**: The audio engine's IEC FAST exponential mean-square
(τ = 125 ms) spreads each whistle→breath transition over ~10 frames. Modeling
in linear power space:

| Frame after whistle stops | Smoothed dBFS | Per-frame drop |
|---|---|---|
| 1 (50 ms) | −32.7 | 1.7 dB |
| 2 (100 ms) | −34.5 | 1.8 dB |
| 3 (150 ms) | −36.2 | 1.7 dB |
| ... | ... | ~1.7 dB each |

The original "drop gate" rejected samples > 6 dB below the previous accepted
sample. With the smoothing, **no two consecutive samples ever differ by > 3 dB
during a transition**, so the drop gate never fired.

The fallback "floor gate" used the rolling median of accepted samples. As
breath samples leaked through and accumulated in the buffer, the median drifted
down to breath level, the threshold drifted with it, and the gate stopped
firing entirely. This is the exact failure mode reported in the field
(with screenshots showing 48cm and 58cm bins at −73 dBFS while 32cm and
39cm bins were at −31 dBFS).

**Remedy**:
- Replace the median with a **time-windowed MAX** of accepted samples (last
  3 s). MAX holds at the recent peak even during sustained breaths because
  rejected samples never enter the buffer.
- Increase headroom from 8 dB (median-based) to 18 dB (max-based) to allow
  for a wide sweep range.
- Add the cross-bin breath rejection step (§6.2) as the actual safety net for
  correctness — the live gate is now primarily for UX feedback.

**Lesson**: When you're filtering a smoothed signal, the smoothing's time
constant must be smaller than your filter window. If you can't make the filter
window longer than the smoothing transient, the filter cannot catch transitions.
Build correctness checks at a stage that operates on aggregates, not on
per-frame deltas.

### 8.2 Per-bin trimming fails when breath dominates a bin

**Symptom**: Even after the live gate was patched, the calibration offset was
still wildly off (146 dB instead of 128 dB) when the user paused to breathe at
the extremes of their sweep.

**Diagnosis**: Per-bin trim drops samples > 8 dB below the *bin's own median*.
But if the user paused at 50 cm and most samples in the 50 cm bin are breath
samples, the bin median IS the breath floor. There are no samples below it
to trim.

**Remedy**: Cross-bin breath rejection (§6.2). Use the **highest-dB cluster
across the entire dataset** as the whistle reference, not the per-bin median.
Reject samples whose implied intercept is far below this cluster, regardless
of which bin they fall in.

**Lesson**: Local statistics fail when local data is dominated by the noise
you're trying to filter. You need a *global* reference, and that reference
must be biased toward the signal (in this case, the loudest cluster).

### 8.3 SVG `viewBox` with `width="100%"` and no explicit height

**Symptom**: The stripchart was rendering 20–30% taller than the thermometer,
breaking visual Y-axis alignment.

**Diagnosis**: With `width="100%"` and a `viewBox` but no `height` attribute,
browsers compute display height from `renderedWidth / viewBoxAspect`. The
container was wider than the viewBox's nominal 600 px, so the height inflated
proportionally.

**Remedy**: Use `ResizeObserver` to measure the container's actual pixel
width, then render the SVG with explicit `width={measured}` and
`height={CHART_TOTAL_HEIGHT}` (no viewBox). Locks vertical at the shared
constant; only the horizontal flexes.

**Lesson**: Don't mix relative SVG sizing with viewBox if you need precise
alignment. Either go fully responsive (viewBox + preserveAspectRatio) or fully
measured (ResizeObserver + pixel coords). Mixing them produces aspect-driven
height that breaks layouts.

### 8.4 TypeScript EventTarget variance error

**Symptom**:

> Class 'SplEngine' incorrectly extends base class 'EventTarget'.
> Types of property 'addEventListener' are incompatible.

**Diagnosis**: When a class extends `EventTarget` and the merged interface
declares typed `addEventListener` overloads, TypeScript correctly enforces
that the overload type be assignable to the base. The strict typed signature
(`listener: (ev: SplEngineEventMap[K]) => void`) is *not* assignable to the
base's `listener: EventListenerOrEventListenerObject | null`.

**Remedy**: The lib.dom.d.ts pattern — declare both the typed *and* the wide
overload in the merging interface:

```ts
interface SplEngine {
  addEventListener<K extends keyof SplEngineEventMap>(
    type: K,
    listener: (ev: SplEngineEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  addEventListener(  // wide fallback — required for variance compatibility
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
}
```

**Lesson**: When extending DOM event targets, copy lib.dom.d.ts's pattern
exactly. The wide overload isn't redundant — it's required for the merged
type to be assignable to the base.

### 8.5 Stripchart kept advancing after Stop was pressed

**Symptom**: User pressed Stop; the stripchart kept scrolling, slowly walking
existing data off the left edge.

**Diagnosis**: The bucket-flush `setInterval` ran unconditionally regardless
of whether the meter was running.

**Remedy**: `useStripchartHistory` now takes an `enabled` flag (driven by
`spl.status.running`). When it goes false, the interval tears down and the
chart freezes. When it goes true, history clears for a fresh capture.

**Lesson**: Visualizations that are "live" need an explicit lifecycle. Tying
them to a master Start/Stop state via an `enabled` parameter is cleaner than
gating inside the render path.

### 8.6 Emscripten console noise as overlay errors

**Symptom**: Next.js dev overlay flagged
`INFO: Created TensorFlow Lite XNNPACK delegate for CPU` as a runtime error.

**Diagnosis**: Emscripten routes WASM stdout *and* stderr through
`console.error`. Next's dev overlay surfaces anything written to
`console.error`, regardless of its actual severity.

**Remedy**: Wrap the first `detectForVideo` call in a temporary
`console.error` filter that swallows lines beginning with the known TFLite
INFO pattern. Filter is restored after the first call completes; nothing
suppresses real errors.

**Lesson**: Dev overlays are over-eager classifiers. When integrating
WASM-heavy libraries, expect noise on `console.error` and decide upfront
whether to filter narrowly or accept the noise. Don't suppress broadly.

---

## 9. Open Issues / Future Work

In rough priority order:

1. **Focal length calibration step.** The 60° FOV default is the largest
   systematic error in distance estimation. A one-shot calibration
   (face at a tape-measured 30 cm → back-solve focal length from observed
   IPD pixels) would eliminate this.
2. **Per-device offset persistence.** localStorage keyed on
   `MediaStreamTrack.getSettings().deviceId` so users don't recalibrate the
   same hardware twice.
3. **Windows enhancement detection.** Auto-prompt for `mmsys.cpl` when the
   regression slope is far from −20 dB/decade — currently relies on the user
   noticing the quality grade.
4. **Faster time constant for calibration mode.** Expose τ as an engine
   option so calibration can use a 25 ms FAST equivalent, sharpening the
   transition edges that the current FAST mode smooths.
5. **Headset re-calibration prompt.** The engine emits `devicechange` events
   but nothing in the UI reacts to them yet.
6. **Bottle-whistle reference fitting in V calibration.** Rather than fixing
   ref_db = 92.8, allow the user to provide a measured reference at a known
   distance (e.g., from a Class 2 SLM they have access to).

---

## 10. How to Hand This Over

If you're picking this up cold:

1. **Read** §3.2 (browser enhancements) and §6 (breath gaps). Everything else
   is implementation details.
2. **Run** `npm install && npm test`. 33 tests should pass. If any fail before
   you've made changes, suspect the environment, not the code.
3. **Run** `npm run dev` and click Start. The mic permission dialog appears;
   accept it. The stripchart should immediately show readings near your room's
   ambient SPL (typically 35–55 dB SPL).
4. **Calibrate** with the bottle. If you get an offset between 110 and 135 dB
   and a quality grade of `good` or `excellent`, the system is healthy.
5. **Read** the test for `rejectBreathOutliers` in `bottleWhistle.test.ts`.
   It encodes the failure mode that drove half the engineering effort here;
   if you ever find yourself relaxing it, re-read §8.1 first.

The system is intentionally three layers: framework-free engines (`audio/`,
`distance/`), pure-math calibration, React UI on top. Don't blur the boundaries
— each layer has been independently testable, and that has paid for itself
several times over.
