"use client";

// ============================================================================
// SAY AH — APP ENTRY
//
// Replaces the prototype's `showScreen()` function with a simple state
// machine. Each screen is rendered conditionally; transitions are driven by
// callbacks that update both the screen state and the relevant session state.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { TOTAL_REPS, DB_SPL_CALIBRATION_OFFSET } from "@/lib/constants";
import { useAudioAnalyser } from "@/hooks/useAudioAnalyser";
import { useSession, type RepResult } from "@/hooks/useSession";
import { primeVoices } from "@/lib/tts";
import { coachVoice } from "@/lib/coachVoice";
import { setActiveCalibrationOffset } from "@/lib/audio";
import {
  loadCoachEnabled,
  saveCoachEnabled,
  loadCoachVoice,
  loadCoachingLevel,
  loadDeviceOffset,
} from "@/lib/storage";
import { ConstraintDiagnostic } from "@/components/ConstraintDiagnostic";
import { WelcomeScreen } from "@/components/screens/WelcomeScreen";
import { MicPermissionScreen } from "@/components/screens/MicPermissionScreen";
import { PreRepScreen } from "@/components/screens/PreRepScreen";
import { ExerciseScreen } from "@/components/screens/ExerciseScreen";
import { RepResultScreen } from "@/components/screens/RepResultScreen";
import { SessionCompleteScreen } from "@/components/screens/SessionCompleteScreen";
import { HistoryScreen } from "@/components/screens/HistoryScreen";
import { FeedbackModal } from "@/components/FeedbackModal";
import type { ScreenId, RepCompletion } from "@/lib/types";

export default function Page() {
  const [screen, setScreen] = useState<ScreenId>("welcome");
  const [repResult, setRepResult] = useState<RepResult | null>(null);
  const [summaryMessage, setSummaryMessage] = useState("");
  const [coachEnabled, setCoachEnabled] = useState(true);

  const analyser = useAudioAnalyser({ coachEnabled });
  const session = useSession(TOTAL_REPS, analyser.deviceId);

  // Apply the per-device calibration offset once the mic deviceId resolves, so
  // every dB SPL conversion (meter, zones, coach) uses the calibrated value.
  useEffect(() => {
    if (analyser.deviceId) {
      setActiveCalibrationOffset(
        loadDeviceOffset(analyser.deviceId, DB_SPL_CALIBRATION_OFFSET),
      );
    }
  }, [analyser.deviceId]);

  // Hydrate persisted settings from localStorage after mount. Reading
  // localStorage during render would hydrate-mismatch under SSR, so this
  // one-time setState in an effect is the intended "subscribe to an external
  // system" case (same pattern as useSession).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCoachEnabled(loadCoachEnabled());
    primeVoices();
    coachVoice.setVoice(loadCoachVoice());
    // Start loading the Kokoro model early (in the worker) when the coach is
    // on, so it's warm by the first round instead of cold-loading mid-session.
    if (loadCoachEnabled() && loadCoachingLevel() !== "minimal") {
      void coachVoice.load();
    }
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

  const handleStartRep = useCallback(() => {
    setScreen("exercise");
  }, []);

  const handleRepComplete = useCallback(
    (completion: RepCompletion) => {
      const result = session.completeRep(completion);
      setRepResult(result);
      // Long-form encouragement via the Kokoro coach voice (synthesized in the
      // worker, off the main thread). Wait briefly for it; if it's not ready in
      // time fall back to Web Speech so feedback is never delayed several
      // seconds (the dynamic text can't be pre-cached).
      if (result.feedback.spoken)
        void coachVoice.speak(result.feedback.spoken, { maxWaitMs: 6000 });
      setScreen("rep-result");
    },
    [session],
  );

  const handleNextRep = useCallback(() => {
    coachVoice.cancel();
    session.advanceRep();
    setScreen("exercise");
  }, [session]);

  const handleSeeResults = useCallback(() => {
    coachVoice.cancel();
    const msg = session.finishSession();
    setSummaryMessage(msg);
    void coachVoice.speak(msg, { maxWaitMs: 6000 });
    setScreen("session-complete");
  }, [session]);

  const handleFinish = useCallback(() => {
    coachVoice.cancel();
    session.reset();
    setScreen("welcome");
  }, [session]);

  const handleRestart = useCallback(() => {
    coachVoice.cancel();
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
          floorDb={session.floorDb}
          onRepComplete={handleRepComplete}
        />
      )}
      {screen === "rep-result" && repResult && (
        <RepResultScreen
          result={repResult}
          durations={session.durations}
          floorDb={session.floorDb}
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
