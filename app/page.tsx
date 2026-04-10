"use client";

// ============================================================================
// SAY AH — APP ENTRY
//
// Replaces the prototype's `showScreen()` function with a simple state
// machine. Each screen is rendered conditionally; transitions are driven by
// callbacks that update both the screen state and the relevant session state.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { TOTAL_REPS } from "@/lib/constants";
import { useAudioAnalyser } from "@/hooks/useAudioAnalyser";
import { useSession, type RepResult } from "@/hooks/useSession";
import { primeVoices, speakMessage, cancelSpeech } from "@/lib/tts";
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

  const session = useSession(TOTAL_REPS);
  const analyser = useAudioAnalyser();

  // Prime TTS voice list once on mount
  useEffect(() => {
    primeVoices();
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {screen === "welcome" && (
        <WelcomeScreen
          userName={session.userName}
          onUserNameChange={session.setUserName}
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
          onStart={handleStartRep}
        />
      )}
      {screen === "exercise" && (
        <ExerciseScreen
          currentRep={session.currentRep}
          tip={session.nextRepTip}
          analyser={analyser}
          onRepComplete={handleRepComplete}
        />
      )}
      {screen === "rep-result" && repResult && (
        <RepResultScreen
          result={repResult}
          onNext={handleNextRep}
          onSeeResults={handleSeeResults}
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
      <FeedbackModal currentScreen={screen} />
    </div>
  );
}
