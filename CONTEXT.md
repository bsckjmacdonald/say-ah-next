# Say Ah

A web app for LSVT-style voice exercises. Patients sustain "ahhh" reps while the
app measures their voice and coaches loudness. Primary users are elderly people
with Parkinson's disease, often supported by a clinician (in person or over Zoom).

## Language

**Target band**:
The range of loudness a rep should land in to count as "good" — bounded below by
the soft threshold and above by the loud threshold. Defined in raw RMS, not dB SPL.
_Avoid_: green range, green zone (UI colour, not the concept), sweet spot

**Soft threshold** (bottom of the band):
The minimum acceptable loudness. Below it, a rep is "too soft". Clinically the most
important boundary in LSVT — the whole therapy is about getting loud enough.
_Avoid_: floor, quiet line, min

**Loud threshold** (top of the band):
The loudness above which a rep is "too loud" / straining. A safety guard, not the
therapeutic goal. Capturing it by making the patient actually strain is undesirable.
_Avoid_: ceiling, max, red line

**Calibration**:
Setting a patient's target band for a session by capturing the loudness of real
voice samples on the device in use, rather than relying on an absolute dB SPL number.
The clinician's ear is the ground truth for "too soft" / "too loud".
_Avoid_: tuning, setup, levelling

**RMS**:
Root-mean-square amplitude of the mic signal, 0–1, computed per frame. The app's
internal unit of loudness. Device- and placement-dependent, which is why a fixed
band fails across patients/devices.

**dB SPL (estimated)**:
A display-only number derived from RMS plus a fixed offset. Not a true calibrated
sound-pressure reading and not achievable in-browser (especially on iOS). Secondary
to the clinician's judgement.
_Avoid_: volume, decibels (when precision matters)

**Anchor**:
A loudness value captured from a real voice sample (median RMS over a hold). The
band's two anchors are the captured soft and loud values; onset/offset derive from
them by fixed ratios.

**Test rep**:
An optional practice rep run on the calibrate screen, scored live against the
just-captured band, so the clinician can confirm by ear before committing it to the
real session. Costs a little patient voice, hence optional.

**Clinician**:
The therapist (SLP) supporting the patient, present in person or over Zoom. Operates
the calibration; their auditory judgement defines the band.
_Avoid_: coach (that is the in-app TTS voice), therapist, doctor

**Patient**:
The person doing the voice exercise. Has Parkinson's; tends to under-perceive their
own loudness and fatigues quickly, so their voice should not be spent on calibration.
_Avoid_: user, client
