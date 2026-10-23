import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpeechQueue, selectVoice, speechSynthesisSupport } from "../lib/voice/synthesis.js";
import type { VoicePreferences } from "../lib/voice/types.js";

export interface SpeechOutputController {
  supported: boolean;
  supportMessage: string | null;
  voices: SpeechSynthesisVoice[];
  speakingId: string | null;
  error: string | null;
  speak: (id: string, text: string) => boolean;
  stop: () => void;
  toggle: (id: string, text: string) => void;
  test: () => void;
  clearError: () => void;
}

const TEST_SENTENCE =
  "Hi, I'm HomePilot. I can read plans and household answers aloud while you review them.";

export function useSpeechOutput(preferences: VoicePreferences): SpeechOutputController {
  const support = useMemo(
    () => speechSynthesisSupport(typeof window === "undefined" ? null : window),
    [],
  );

  const synth = useMemo(() => {
    if (!support.supported || typeof window === "undefined") return null;
    return window.speechSynthesis;
  }, [support.supported]);

  const queue = useMemo(() => {
    if (!support.supported || typeof window === "undefined") return null;
    const synthesis = window.speechSynthesis;
    return new SpeechQueue(
      {
        speak: (utterance) => synthesis.speak(utterance),
        cancel: () => synthesis.cancel(),
      },
      (text) => new window.SpeechSynthesisUtterance(text),
    );
  }, [support.supported]);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    synth ? synth.getVoices() : [],
  );
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefsRef = useRef(preferences);

  useEffect(() => {
    prefsRef.current = preferences;
  }, [preferences]);

  // Voice lists load asynchronously in Chrome; re-read on the event and once
  // after a short delay as a fallback for engines that never fire it.
  useEffect(() => {
    if (!synth) return;
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      try {
        setVoices([...synth.getVoices()]);
      } catch {
        setVoices([]);
      }
    };
    load();
    synth.addEventListener("voiceschanged", load);
    const timer = window.setTimeout(load, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", load);
    };
  }, [synth]);

  const stop = useCallback(() => {
    queue?.stop();
    setSpeakingId(null);
  }, [queue]);

  const speak = useCallback(
    (id: string, text: string): boolean => {
      if (!queue || !synth) {
        setError(support.reason ?? "Spoken replies aren't available in this browser.");
        return false;
      }
      const prefs = prefsRef.current;
      const available = voices.length > 0 ? voices : synth.getVoices();
      const voice = selectVoice(available, prefs.language, prefs.voiceURI);
      const started = queue.speak(text, {
        rate: prefs.rate,
        volume: prefs.volume,
        lang: prefs.language,
        voice,
        onEnd: () => setSpeakingId((current) => (current === id ? null : current)),
        onError: (message) => {
          setSpeakingId((current) => (current === id ? null : current));
          if (message) setError(message);
        },
      });
      if (started) {
        setSpeakingId(id);
        setError(null);
      }
      return started;
    },
    [queue, synth, support.reason, voices],
  );

  const toggle = useCallback(
    (id: string, text: string) => {
      if (speakingId === id) stop();
      else speak(id, text);
    },
    [speak, speakingId, stop],
  );

  const test = useCallback(() => {
    speak("__voice_test__", TEST_SENTENCE);
  }, [speak]);

  // A language switch should not leave the previous language speaking.
  useEffect(() => {
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.language]);

  // Leaving the conversation / unmounting releases the audio channel.
  useEffect(() => () => queue?.stop(), [queue]);

  return {
    supported: support.supported,
    supportMessage: support.reason,
    voices,
    speakingId,
    error,
    speak,
    stop,
    toggle,
    test,
    clearError: () => setError(null),
  };
}
