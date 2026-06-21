"use client";

// ============================================================================
// SAY AH — APP ENTRY
//
// Replaces the prototype's `showScreen()` function with a simple state
// machine. Each screen is rendered conditionally; transitions are driven by
// callbacks that update both the screen state and the relevant session state.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { TOTAL_REPS } from "@/lib/constants";
import { useAudioAnalyser } from "@/hooks/useAudioAnalyser";
import { useSession, type RepResult } from "@/hooks/useSession";
import { primeVoices, speakMessage, cancelSpeech } from "@/lib/tts";
import {
  loadBand,
  loadCoachEnabled,
  saveBand,
  saveCoachEnabled,
} from "@/lib/storage";
import { ConstraintDiagnostic } from "@/components/ConstraintDiagnostic";
import { WelcomeScreen } from "@/components/screens/WelcomeScreen";
import { CalibrateScreen } from "@/components/screens/CalibrateScreen";
import { MicPermissionScreen } from "@/components/screens/MicPermissionScreen";
import { PreRepScreen } from "@/components/screens/PreRepScreen";
import { ExerciseScreen } from "@/components/screens/ExerciseScreen";
import { RepResultScreen } from "@/components/screens/RepResultScreen";
import { SessionCompleteScreen } from "@/components/screens/SessionCompleteScreen";
import { HistoryScreen } from "@/components/screens/HistoryScreen";
import { FeedbackModal } from "@/components/FeedbackModal";
import type { TargetBand } from "@/lib/calibration";
import type { ScreenId, RepCompletion } from "@/lib/types";

export default function Page() {
  const [screen, setScreen] = useState<ScreenId>("welcome");
  const [repResult, setRepResult] = useState<RepResult | null>(null);
  const [summaryMessage, setSummaryMessage] = useState("");
  const [coachEnabled, setCoachEnabled] = useState(true);
  // True once a clinician has committed a calibrated band this session — gates
  // the "re-calibrate?" prompt that appears when the audio scale changes.
  const [calibrated, setCalibrated] = useState(false);

  const session = useSession(TOTAL_REPS);
  const analyser = useAudioAnalyser({ coachEnabled, band: session.band });

  // Band to restore if the clinician cancels out of calibration.
  const prevBandRef = useRef<TargetBand>(session.band);

  // Hydrate persisted settings from localStorage after mount. Reading
  // localStorage during render would hydrate-mismatch under SSR, so this
  // one-time setState in an effect is the intended pattern (see useSession).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCoachEnabled(loadCoachEnabled());
    primeVoices();
  }, []);

  const handleCoachToggle = useCallback((value: boolean) => {
    setCoachEnabled(value);
    saveCoachEnabled(value);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleBegin = useCallback(() => {
    session.startSession();
    if (analyser.isReady()) {
      setScreen("pre-rep");
    } else {
      setScreen("mic-permission");
    }
  }, [analyser, session]);

  const handleMicGranted = useCallback(() => {
    setScreen("pre-rep");
  }, []);

  // ── Calibration ────────────────────────────────────────────────────────
  const handleShowCalibrate = useCallback(() => {
    prevBandRef.current = session.band;
    // Pre-fill from the last band stored for this device, if any; the clinician
    // confirms by ear or re-demos.
    const prefill = analyser.deviceId ? loadBand(analyser.deviceId) : null;
    if (prefill) session.setBand(prefill);
    setScreen("calibrate");
  }, [analyser.deviceId, session]);

  const handleCalibrateCommit = useCallback(
    (band: TargetBand) => {
      if (analyser.deviceId) saveBand(analyser.deviceId, band);
      session.setBand(band);
      setCalibrated(true);
      analyser.dismissRecalibration();
      session.startSession();
      setScreen(analyser.isReady() ? "pre-rep" : "mic-permission");
    },
    [analyser, session],
  );

  const handleCalibrateCancel = useCallback(() => {
    session.setBand(prevBandRef.current);
    setScreen("welcome");
  }, [session]);

  const handleStartRep = useCallback(() => {
    setScreen("exercise");
  }, []);

  const handleRepComplete = useCallback(
    (completion: RepCompletion) => {
      const result = session.completeRep(completion);
      setRepResult(result);
      // Slightly warmer-than-default prosody for the long-form encouragement.
      // Coach cues use a stronger boost (see ExerciseScreen); this is gentler
      // because these messages are full sentences, not short bursts.
      if (result.feedback.spoken)
        speakMessage(result.feedback.spoken, { rate: 1.08, pitch: 1.1 });
      setScreen("rep-result");
    },
    [session],
  );

  const handleNextRep = useCallback(() => {
    cancelSpeech();
    session.advanceRep();
    setScreen("exercise");
  }, [session]);

  const handleSeeResults = useCallback(() => {
    cancelSpeech();
    const msg = session.finishSession();
    setSummaryMessage(msg);
    speakMessage(msg, { rate: 1.08, pitch: 1.1 });
    setScreen("session-complete");
  }, [session]);

  const handleFinish = useCallback(() => {
    cancelSpeech();
    session.reset();
    setScreen("welcome");
  }, [session]);

  const handleRestart = useCallback(() => {
    cancelSpeech();
    session.startSession();
    setScreen(analyser.isReady() ? "pre-rep" : "mic-permission");
  }, [analyser, session]);

  const handleShowHistory = useCallback(() => {
    session.refreshHistory();
    setScreen("history");
  }, [session]);

  const handleBackToWelcome = useCallback(() => {
    setScreen("welcome");
  }, []);

  const handleDiscardRecording = useCallback(() => {
    analyser.discardCurrentAudio();
  }, [analyser]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {screen === "welcome" && (
        <WelcomeScreen
          userName={session.userName}
          onUserNameChange={session.setUserName}
          coachEnabled={coachEnabled}
          onCoachToggle={handleCoachToggle}
          onBegin={handleBegin}
          onShowHistory={handleShowHistory}
          onCalibrate={handleShowCalibrate}
        />
      )}
      {screen === "calibrate" && (
        <CalibrateScreen
          analyser={analyser}
          band={session.band}
          onBandChange={session.setBand}
          onCommit={handleCalibrateCommit}
          onCancel={handleCalibrateCancel}
        />
      )}
      {screen === "mic-permission" && (
        <MicPermissionScreen
          onRequestMic={analyser.requestPermission}
          onGranted={handleMicGranted}
        />
      )}
      {screen === "pre-rep" && (
        <PreRepScreen
          currentRep={session.currentRep}
          tip={session.nextRepTip}
          coachEnabled={coachEnabled}
          onCoachToggle={handleCoachToggle}
          onStart={handleStartRep}
        />
      )}
      {screen === "exercise" && (
        <ExerciseScreen
          currentRep={session.currentRep}
          tip={session.nextRepTip}
          analyser={analyser}
          band={session.band}
          onRepComplete={handleRepComplete}
        />
      )}
      {screen === "rep-result" && repResult && (
        <RepResultScreen
          result={repResult}
          durations={session.durations}
          band={session.band}
          coachEnabled={coachEnabled}
          onCoachToggle={handleCoachToggle}
          onNext={handleNextRep}
          onSeeResults={handleSeeResults}
          onDiscardRecording={handleDiscardRecording}
        />
      )}
      {screen === "session-complete" && (
        <SessionCompleteScreen
          durations={session.durations}
          summaryMessage={summaryMessage}
          personalBest={session.personalBest}
          onFinish={handleFinish}
          onRestart={handleRestart}
        />
      )}
      {screen === "history" && (
        <HistoryScreen
          history={session.history}
          onBack={handleBackToWelcome}
        />
      )}
      {calibrated && analyser.needsRecalibration && screen === "pre-rep" && (
        <div className="recalibrate-prompt" role="alert">
          <p>
            The microphone setup changed, so the saved volume range may no longer
            match. Re-calibrate before continuing?
          </p>
          <div className="button-group">
            <button className="btn-secondary" onClick={handleShowCalibrate}>
              Re-calibrate
            </button>
            <button
              className="calibrate-text-link"
              onClick={analyser.dismissRecalibration}
            >
              Keep current range
            </button>
          </div>
        </div>
      )}
      {(screen === "pre-rep" ||
        screen === "exercise" ||
        screen === "rep-result") && (
        <ConstraintDiagnostic
          status={analyser.constraintStatus}
          deviceId={analyser.deviceId}
        />
      )}
      <FeedbackModal currentScreen={screen} />
    </div>
  );
}
