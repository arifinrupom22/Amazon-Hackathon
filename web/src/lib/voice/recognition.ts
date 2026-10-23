import type { VoiceFailure, VoiceLanguage, VoiceSupport } from "./types.js";
import { voiceLanguageOption } from "./types.js";

/* -------------------------------------------------------------------------- */
/* Minimal structural types for the Web Speech API (not in lib.dom for all   */
/* browsers). Nothing here fabricates support: a constructor must exist.      */
/* -------------------------------------------------------------------------- */

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike | undefined;
}

export interface SpeechRecognitionResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface RecognitionScope {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

/** Return the browser's recognizer constructor, or null when none exists. */
export function getRecognitionCtor(scope: unknown): SpeechRecognitionCtor | null {
  if (!scope || typeof scope !== "object") return null;
  const candidate = scope as RecognitionScope;
  const ctor = candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

export function recognitionSupport(scope: unknown): VoiceSupport {
  if (getRecognitionCtor(scope)) return { supported: true, reason: null };
  return {
    supported: false,
    reason:
      "Speech recognition isn't available in this browser. Chrome or Edge on desktop support it; typing still works everywhere.",
  };
}

/** Normalize whitespace without changing the words. */
export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Join an existing draft with newly recognized speech without duplicating text
 * when the engine replays an overlapping result.
 */
export function mergeTranscript(base: string, addition: string): string {
  const existing = normalizeTranscript(base);
  const incoming = normalizeTranscript(addition);
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing === incoming || existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;
  return `${existing} ${incoming}`;
}

export function extractTranscript(
  results: SpeechRecognitionResultListLike,
  resultIndex = 0,
): { final: string; interim: string } {
  let final = "";
  let interim = "";
  for (let index = Math.max(0, resultIndex); index < results.length; index += 1) {
    const result = results[index];
    const transcript = result?.[0]?.transcript ?? "";
    if (result?.isFinal) final += ` ${transcript}`;
    else interim += ` ${transcript}`;
  }
  return { final: normalizeTranscript(final), interim: normalizeTranscript(interim) };
}

/**
 * Translate a SpeechRecognition error code into a human, actionable state.
 * `aborted` is intentional (user cancel / cleanup) and returns null.
 */
export function describeRecognitionError(code: string, language: VoiceLanguage): VoiceFailure | null {
  const languageLabel = voiceLanguageOption(language).label;
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return {
        code,
        title: "Microphone access was denied",
        message:
          "Your browser blocked the microphone. Allow microphone access for this site in your browser settings, then try again. Typing still works.",
        retryable: true,
      };
    case "audio-capture":
      return {
        code,
        title: "No microphone found",
        message:
          "No working microphone was detected. Connect or enable one, check your system input settings, then try again.",
        retryable: true,
      };
    case "no-speech":
      return {
        code,
        title: "I didn't hear anything",
        message: "The microphone was open but no speech was detected. Try again and speak a little closer.",
        retryable: true,
      };
    case "network":
      return {
        code,
        title: "The speech service didn't answer",
        message:
          "Your browser couldn't reach its speech service. That can be a temporary service problem, a firewall or VPN, or an unavailable language — it does not mean your internet is offline. Try again, switch to Google transcription if configured, or type the request.",
        retryable: true,
      };
    case "language-not-supported":
      return {
        code,
        title: `${languageLabel} recognition isn't supported here`,
        message:
          language === "bn-BD"
            ? "This browser's recognizer cannot process Bengali. Switch to English or type the request."
            : "This browser's recognizer rejected the selected language. Try another language or type instead.",
        retryable: language !== "bn-BD",
      };
    case "bad-grammar":
      return {
        code,
        title: "That didn't come through",
        message: "The recognizer could not parse the speech. Try again with a shorter phrase.",
        retryable: true,
      };
    case "start-failed":
      return {
        code,
        title: "Voice input couldn't start",
        message: "The microphone is busy or unavailable. Close other apps using it, then try again.",
        retryable: true,
      };
    default:
      return {
        code,
        title: "Voice input stopped",
        message: "The recognizer reported an unexpected problem. You can retry or type the request.",
        retryable: true,
      };
  }
}

export interface RecognitionHandlers {
  onListening: () => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onFailure: (failure: VoiceFailure) => void;
  onEnd: (info: { hadFinal: boolean; wasAborted: boolean }) => void;
  /** Called once before the single automatic retry of a network failure. */
  onRetry?: (attempt: number) => void;
}

/**
 * Owns exactly one recognition instance. A second `start()` while active is a
 * no-op, which prevents overlapping microphone sessions.
 */
export class RecognitionSession {
  private recognition: SpeechRecognitionLike | null = null;
  private finalText = "";
  private active = false;
  private aborted = false;
  private stopping = false;
  private failure: VoiceFailure | null = null;
  private networkAttempts = 0;
  private retryScheduled = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctor: SpeechRecognitionCtor,
    private readonly language: VoiceLanguage,
    private readonly handlers: RecognitionHandlers,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  start(preserveNetworkAttempts = false): boolean {
    if (this.active) return false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.finalText = "";
    this.aborted = false;
    this.stopping = false;
    this.failure = null;
    this.retryScheduled = false;
    if (!preserveNetworkAttempts) this.networkAttempts = 0;

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new this.ctor();
    } catch {
      this.handlers.onFailure({
        code: "start-failed",
        title: "Voice input couldn't start",
        message: "The microphone is busy or unavailable. Close other apps using it, then try again.",
        retryable: true,
      });
      return false;
    }

    recognition.lang = this.language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      // A stop requested while the permission prompt was open must not bounce
      // the UI back into "Listening" once the microphone finally opens.
      if (this.stopping) return;
      this.handlers.onListening();
    };

    recognition.onresult = (event) => {
      const { final, interim } = extractTranscript(event.results, event.resultIndex);
      if (interim) this.handlers.onInterim(interim);
      if (final) {
        this.finalText = mergeTranscript(this.finalText, final);
        this.handlers.onFinal(this.finalText);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || this.aborted) {
        this.aborted = true;
        return;
      }
      // One bounded retry for a transport-style failure. Never loop: a second
      // network error is reported with a real explanation and recovery steps.
      if (event.error === "network" && this.networkAttempts < 1 && !this.finalText && !this.stopping) {
        this.networkAttempts += 1;
        this.retryScheduled = true;
        this.handlers.onRetry?.(this.networkAttempts);
        return;
      }
      const failure = describeRecognitionError(event.error, this.language);
      if (failure) {
        this.failure = failure;
        this.handlers.onFailure(failure);
      }
    };

    recognition.onend = () => {
      this.active = false;
      this.recognition = null;
      if (this.retryScheduled) {
        this.retryScheduled = false;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.aborted) this.start(true);
        }, 450);
        return;
      }
      this.handlers.onEnd({ hadFinal: Boolean(this.finalText), wasAborted: this.aborted || Boolean(this.failure) });
    };

    this.recognition = recognition;
    this.active = true;

    try {
      recognition.start();
      return true;
    } catch {
      this.active = false;
      this.recognition = null;
      const failure: VoiceFailure = {
        code: "start-failed",
        title: "Voice input couldn't start",
        message: "The microphone is busy or unavailable. Close other apps using it, then try again.",
        retryable: true,
      };
      this.failure = failure;
      this.handlers.onFailure(failure);
      return false;
    }
  }

  /** Finish gracefully so a final result can still arrive. */
  stop(): void {
    this.stopping = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.retryScheduled = false;
      this.handlers.onEnd({ hadFinal: Boolean(this.finalText), wasAborted: false });
      return;
    }
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch {
      this.recognition = null;
      this.active = false;
    }
  }

  /** Drop the session immediately (unmount, navigation, language change). */
  abort(): void {
    this.aborted = true;
    this.stopping = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.retryScheduled = false;
    }
    if (!this.recognition) return;
    try {
      this.recognition.abort();
    } catch {
      /* already finished */
    }
    this.recognition = null;
    this.active = false;
  }
}
