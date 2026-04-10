// ============================================================================
// SAY AH — TEXT-TO-SPEECH
// Browser Web Speech API only. The prototype's Kokoro/HF code path is dropped:
// it required a hard-coded API token, was blocked by CORS, and never executed
// in practice. If we add a server-side TTS later it should live in a Next.js
// route handler, not in client code.
//
// Tiered voice picker: macOS premium → Google/Microsoft → any English →
// fallback. Direct port of the priority list from say_ah.html.
// ============================================================================

let voicesPrimed = false;

/** Call once on first user interaction so the browser starts loading voices. */
export function primeVoices(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (voicesPrimed) return;
  voicesPrimed = true;
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices(); // prime cache
    };
  }
}

export interface SpeakOptions {
  /** 0.1–10, default 1. >1 = faster. */
  rate?: number;
  /** 0–2, default 1. >1 = higher pitch (reads as more energetic). */
  pitch?: number;
  /** 0–1, default 1. */
  volume?: number;
}

// NOTE: prosody control via SpeechSynthesisUtterance is crude — rate and
// pitch are blunt instruments and the result still sounds like browser TTS.
// The LSVT real-time feedback doc calls for voice-actor recordings or neural
// TTS with per-phrase emphasis. That's the proper fix; this is an interim
// improvement so realtime coach cues sound more energetic than the long
// post-rep encouragement messages.

export function speakMessage(text: string, options?: SpeakOptions): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options?.rate ?? 1.0;
  utterance.pitch = options?.pitch ?? 1.0;
  utterance.volume = options?.volume ?? 1.0;

  const trySpeak = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return; // onvoiceschanged will retry

    const en = voices.filter((v) => v.lang.startsWith("en"));
    let selected: SpeechSynthesisVoice | undefined;

    // Tier 1: macOS premium / Siri voices (downloaded via Accessibility settings)
    for (const name of [
      "Ava (Enhanced)",
      "Ava",
      "Samantha (Enhanced)",
      "Siri (Female)",
      "Siri Female",
      "Kate (Enhanced)",
      "Kate",
      "Serena (Enhanced)",
      "Serena",
      "Karen (Enhanced)",
      "Karen",
      "Moira (Enhanced)",
      "Moira",
    ]) {
      selected = voices.find((v) => v.name === name);
      if (selected) break;
    }

    // Tier 2: any macOS "Enhanced" or "Compact" female voice
    if (!selected) {
      selected = en.find(
        (v) =>
          v.name.includes("Enhanced") && !v.name.toLowerCase().includes("male"),
      );
    }
    if (!selected) {
      selected = en.find(
        (v) =>
          v.name.includes("Compact") && !v.name.toLowerCase().includes("male"),
      );
    }

    // Tier 3: Google / Microsoft cloud voices (Chrome / Edge)
    if (!selected) {
      for (const name of [
        "Google US English",
        "Google UK English Female",
        "Microsoft Aria Online",
        "Microsoft Jenny Online",
        "Microsoft Zira",
        "Microsoft Hazel",
      ]) {
        selected = voices.find((v) => v.name.includes(name));
        if (selected) break;
      }
    }

    // Tier 4: any labelled female English voice
    if (!selected) selected = en.find((v) => /female/i.test(v.name));

    // Tier 5: any English / fallback
    if (!selected) selected = en[0] || voices[0];

    if (selected) utterance.voice = selected;
    window.speechSynthesis.speak(utterance);
  };

  if (window.speechSynthesis.getVoices().length) {
    trySpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      trySpeak();
    };
  }
}

export function cancelSpeech(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}
