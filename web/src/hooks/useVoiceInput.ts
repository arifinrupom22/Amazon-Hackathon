import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudCapture,
  type TranscribeAudio,
} from "../lib/voice/cloudCapture.js";
import {
  RecognitionSession,
  getRecognitionCtor,
  mergeTranscript,
  recognitionSupport,
} from "../lib/voice/recognition.js";
import type {
  SpeechInputProvider,
  VoiceFailure,
  VoiceLanguage,
  VoiceStatus,
} from "../lib/voice/types.js";

interface UseVoiceInputOptions {
  language: VoiceLanguage;
  provider: SpeechInputProvider;
  /** The server reports whether Google transcription has a usable key. */
  cloudAvailable: boolean;
  /** Disable starting while a request is in flight. */
  enabled?: boolean;
  onTranscript: (text: string) => void;
  transcribe?: TranscribeAudio;
}

interface CaptureSession {
  readonly isActive: boolean;
  stop(): void;
  abort(): void;
}

export interface VoiceInputController {
  supported: boolean;
  supportMessage: string | null;
  provider: SpeechInputProvider;
  cloudAvailable: boolean;
  status: VoiceStatus;
  interim: string;
  /** Short, non-fatal status such as "retrying once". */
  notice: string | null;
  error: VoiceFailure | null;
  start: (baseText?: string) => boolean;
  stop: () => void;
  cancel: () => void;
  clearError: () => void;
  reset: () => void;
}

const STOP_TIMEOUT_MS = 1800;
const CLOUD_STOP_TIMEOUT_MS = 50_000;

function hasRecorderSupport(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export function useVoiceInput({
  language,
  provider,
  cloudAvailable,
  enabled = true,
  onTranscript,
  transcribe,
}: UseVoiceInputOptions): VoiceInputController {
  const ctor = useMemo(() => getRecognitionCtor(typeof window === "undefined" ? null : window), []);
  const browserSupport = useMemo(
    () => recognitionSupport(typeof window === "undefined" ? null : window),
    [],
  );

  const support = useMemo(() => {
    if (provider === "google") {
      if (!cloudAvailable) {
        return {
          supported: false,
          reason:
            "Google transcription is not configured on the server. Add GEMINI_API_KEY there, or switch Speech input to Browser.",
        };
      }
      if (!transcribe || !hasRecorderSupport()) {
        return {
          supported: false,
          reason: "This browser cannot record audio for Google transcription. Switch to Browser speech or type.",
        };
      }
      return { supported: true, reason: null };
    }
    return browserSupport;
  }, [browserSupport, cloudAvailable, provider, transcribe]);

  const [status, setStatus] = useState<VoiceStatus>(support.supported ? "idle" : "unsupported");
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<VoiceFailure | null>(null);

  const sessionRef = useRef<CaptureSession | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const stoppedTimerRef = useRef<number | null>(null);
  const manualStopRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const transcribeRef = useRef(transcribe);
  const languageRef = useRef(language);
  const enabledRef = useRef(enabled);
  const providerRef = useRef(provider);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    transcribeRef.current = transcribe;
  }, [transcribe]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (stoppedTimerRef.current !== null) {
      window.clearTimeout(stoppedTimerRef.current);
      stoppedTimerRef.current = null;
    }
  }, []);

  const finishStatus = useCallback((hadFinal: boolean) => {
    setInterim("");
    const wasManual = manualStopRef.current;
    manualStopRef.current = false;
    setStatus((current) => {
      if (current === "error" || current === "recognized") return current;
      if (current === "processing") return wasManual && !hadFinal ? "stopped" : "idle";
      return current;
    });
    if (wasManual && !hadFinal) {
      if (stoppedTimerRef.current !== null) window.clearTimeout(stoppedTimerRef.current);
      stoppedTimerRef.current = window.setTimeout(() => {
        setStatus((current) => (current === "stopped" ? "idle" : current));
        stoppedTimerRef.current = null;
      }, 2600);
    }
  }, []);

  const startBrowser = useCallback(
    (baseText: string): boolean => {
      if (!ctor) return false;
      const session = new RecognitionSession(ctor, languageRef.current, {
        onListening: () => setStatus("listening"),
        onInterim: (text) => setInterim(text),
        onFinal: (text) => {
          setInterim("");
          onTranscriptRef.current(mergeTranscript(baseText, text));
          setStatus("recognized");
        },
        onFailure: (failure) => {
          setInterim("");
          setNotice(null);
          setError(failure);
          setStatus("error");
        },
        onRetry: () => {
          setNotice("The speech service didn't answer — retrying once…");
          setStatus("requesting");
        },
        onEnd: ({ hadFinal }) => {
          sessionRef.current = null;
          setNotice(null);
          finishStatus(hadFinal);
        },
      });
      sessionRef.current = session;
      const started = session.start();
      if (!started) {
        sessionRef.current = null;
        setStatus((current) => (current === "requesting" ? "error" : current));
      }
      return started;
    },
    [ctor, finishStatus],
  );

  const startCloud = useCallback(
    (baseText: string): boolean => {
      if (!transcribeRef.current) return false;
      const session = new CloudCapture({
        language: languageRef.current,
        transcribe: (audio, selectedLanguage) => transcribeRef.current!(audio, selectedLanguage),
        handlers: {
          onListening: () => setStatus("listening"),
          onTranscribing: () => {
            setNotice(null);
            setStatus("processing");
          },
          onFinal: (text) => {
            setNotice(null);
            onTranscriptRef.current(mergeTranscript(baseText, text));
            setStatus("recognized");
          },
          onFailure: (failure) => {
            setNotice(null);
            setInterim("");
            setError(failure);
            setStatus("error");
          },
          onEnd: ({ hadFinal }) => {
            sessionRef.current = null;
            finishStatus(hadFinal);
          },
        },
      });
      sessionRef.current = session;
      void session.start();
      return true;
    },
    [finishStatus],
  );

  const start = useCallback(
    (baseText = ""): boolean => {
      if (!enabledRef.current || !support.supported) return false;
      if (sessionRef.current?.isActive) return false;

      clearTimers();
      manualStopRef.current = false;
      setError(null);
      setNotice(null);
      setInterim("");
      setStatus("requesting");

      return providerRef.current === "google" ? startCloud(baseText) : startBrowser(baseText);
    },
    [clearTimers, startBrowser, startCloud, support.supported],
  );

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    manualStopRef.current = true;
    setStatus((current) => (current === "listening" || current === "requesting" ? "processing" : current));
    session.stop();
    clearTimers();
    stopTimerRef.current = window.setTimeout(() => {
      if (sessionRef.current === session) {
        session.abort();
        sessionRef.current = null;
        setInterim("");
        setStatus((current) => (current === "processing" ? "idle" : current));
      }
      stopTimerRef.current = null;
    }, providerRef.current === "google" ? CLOUD_STOP_TIMEOUT_MS : STOP_TIMEOUT_MS);
  }, [clearTimers]);

  const cancel = useCallback(() => {
    clearTimers();
    sessionRef.current?.abort();
    sessionRef.current = null;
    setInterim("");
    setNotice(null);
    setError(null);
    setStatus(support.supported ? "idle" : "unsupported");
  }, [clearTimers, support.supported]);

  const reset = useCallback(() => {
    clearTimers();
    setInterim("");
    setNotice(null);
    setStatus(support.supported ? "idle" : "unsupported");
  }, [clearTimers, support.supported]);

  const clearError = useCallback(() => {
    setError(null);
    setStatus((current) => (current === "error" ? (support.supported ? "idle" : "unsupported") : current));
  }, [support.supported]);

  // A provider switch can make voice newly available or unavailable.
  useEffect(() => {
    if (sessionRef.current) return;
    setStatus((current) =>
      current === "idle" || current === "unsupported" ? (support.supported ? "idle" : "unsupported") : current,
    );
  }, [support.supported]);

  // Changing language or provider invalidates any open microphone session.
  useEffect(() => {
    if (sessionRef.current) {
      sessionRef.current.abort();
      sessionRef.current = null;
      setStatus(support.supported ? "idle" : "unsupported");
      setInterim("");
      setNotice(null);
    }
  }, [language, provider, support.supported]);

  useEffect(() => {
    if (!enabled && sessionRef.current) {
      sessionRef.current.abort();
      sessionRef.current = null;
      setStatus(support.supported ? "idle" : "unsupported");
      setInterim("");
    }
  }, [enabled, support.supported]);

  // Stop listening when the tab is hidden — no background microphone use.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if (sessionRef.current) {
        sessionRef.current.abort();
        sessionRef.current = null;
        setStatus(support.supported ? "idle" : "unsupported");
        setInterim("");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [support.supported]);

  // Unmount: release the mic, audio recorder and timers.
  useEffect(() => {
    return () => {
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      if (stoppedTimerRef.current !== null) window.clearTimeout(stoppedTimerRef.current);
      sessionRef.current?.abort();
      sessionRef.current = null;
    };
  }, []);

  return {
    supported: support.supported,
    supportMessage: support.reason,
    provider,
    cloudAvailable,
    status,
    interim,
    notice,
    error,
    start,
    stop,
    cancel,
    clearError,
    reset,
  };
}
