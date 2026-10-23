/**
 * Browser-native text-to-speech helpers.
 *
 * Speech is synthesized locally by the browser. Nothing is uploaded, and the
 * queue is deliberately defensive: long text is split into sentence-sized
 * utterances (some engines cut off long utterances), a new reply cancels the
 * previous one, and errors never remove the written answer.
 */

export interface SpeechEngine {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
}

export type UtteranceFactory = (text: string) => SpeechSynthesisUtterance;

export interface SpeechSynthesisSupport {
  supported: boolean;
  reason: string | null;
}

interface SynthesisScope {
  speechSynthesis?: unknown;
  SpeechSynthesisUtterance?: unknown;
}

export function speechSynthesisSupport(scope: unknown): SpeechSynthesisSupport {
  if (!scope || typeof scope !== "object") {
    return { supported: false, reason: "Speech output isn't available in this browser." };
  }
  const candidate = scope as SynthesisScope;
  const hasSynth = Boolean(candidate.speechSynthesis);
  const hasUtterance = typeof candidate.SpeechSynthesisUtterance === "function";
  if (hasSynth && hasUtterance) return { supported: true, reason: null };
  return {
    supported: false,
    reason:
      "Spoken replies aren't supported in this browser. The full text answer is still shown here and in the conversation.",
  };
}

const MAX_SPEECH_LENGTH = 1200;

/**
 * Make text safe and pleasant to read aloud. Removes code, URLs, markdown,
 * credential-looking strings and raw HTTP noise. Never includes provider
 * diagnostics — callers pass user-facing copy, not error objects.
 */
export function sanitizeForSpeech(input: string): string {
  let text = input;
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{10,})\b/g, " ");
  text = text.replace(/\b(?:GEMINI|OPENAI|OLLAMA|GOOGLE)_[A-Z0-9_]+\b/g, "provider setting");
  text = text.replace(/\bHTTP\s*[1-5]\d{2}\b/gi, " ");
  text = text.replace(/[{}<>]/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_SPEECH_LENGTH).trim();
}

/** Split into sentence-aware chunks short enough for every common engine. */
export function splitForSpeech(text: string, maxLength = 220): string[] {
  const clean = sanitizeForSpeech(text);
  if (!clean) return [];

  const sentences = clean.match(/[^.!?।]+[.!?।]*/g) ?? [clean];
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length > maxLength) {
      flush();
      let line = "";
      for (const word of sentence.split(/\s+/)) {
        if (!line) line = word;
        else if (`${line} ${word}`.length <= maxLength) line = `${line} ${word}`;
        else {
          chunks.push(line);
          line = word;
        }
      }
      if (line) chunks.push(line);
      continue;
    }

    if (!current) current = sentence;
    else if (`${current} ${sentence}`.length <= maxLength) current = `${current} ${sentence}`;
    else {
      flush();
      current = sentence;
    }
  }
  flush();

  return chunks.slice(0, 12);
}

interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  default?: boolean;
}

/** Prefer an explicitly chosen voice, then an exact language, then a base-language match. */
export function selectVoice<T extends VoiceLike>(
  voices: readonly T[],
  language: string,
  preferredURI: string | null,
): T | null {
  if (voices.length === 0) return null;
  const target = language.toLowerCase();
  const base = target.split("-")[0] ?? target;

  if (preferredURI) {
    const preferred = voices.find((voice) => voice.voiceURI === preferredURI);
    if (preferred) return preferred;
  }

  const exact = voices.find((voice) => voice.lang.toLowerCase() === target);
  if (exact) return exact;

  const sameBase = voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === base);
  if (sameBase) return sameBase;

  return voices.find((voice) => voice.default) ?? null;
}

/** A user-facing explanation for SpeechSynthesisErrorEvent codes. */
export function describeSpeechError(code: string | undefined): string | null {
  switch (code) {
    case "interrupted":
    case "canceled":
      return null;
    case "not-allowed":
      return "Your browser blocked audio playback. Allow sound for this site, then try again.";
    case "audio-busy":
      return "Audio is busy in another app. Close it or try again in a moment.";
    case "synthesis-failed":
    case "synthesis-unavailable":
      return "Speech output isn't available right now. The written answer is still here.";
    case "language-unavailable":
    case "voice-unavailable":
      return "That voice isn't available in this browser. Pick another voice in Voice replies settings.";
    default:
      return "Speech output stopped unexpectedly. The written answer is still here.";
  }
}

export interface SpeechQueueOptions {
  rate: number;
  volume: number;
  lang: string;
  voice: SpeechSynthesisVoice | null;
  onEnd: () => void;
  onError: (message: string | null) => void;
}

/**
 * Plays one response at a time. Every `speak()` cancels the previous response,
 * and a generation counter makes stale `onend` callbacks inert.
 */
export class SpeechQueue {
  private generation = 0;
  private active = false;

  constructor(
    private readonly engine: SpeechEngine,
    private readonly createUtterance: UtteranceFactory,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  speak(text: string, options: SpeechQueueOptions): boolean {
    this.stop();
    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return false;

    const generation = ++this.generation;
    this.active = true;

    const speakChunk = (index: number) => {
      if (generation !== this.generation) return;
      if (index >= chunks.length) {
        this.active = false;
        options.onEnd();
        return;
      }
      const utterance = this.createUtterance(chunks[index]!);
      utterance.lang = options.lang;
      utterance.rate = options.rate;
      utterance.volume = options.volume;
      if (options.voice) utterance.voice = options.voice;
      utterance.onend = () => speakChunk(index + 1);
      utterance.onerror = (event) => {
        if (generation !== this.generation) return;
        this.active = false;
        options.onError(describeSpeechError(event.error));
      };
      try {
        this.engine.speak(utterance);
      } catch {
        this.active = false;
        options.onError("Speech output isn't available right now. The written answer is still here.");
      }
    };

    speakChunk(0);
    return true;
  }

  stop(): void {
    this.generation += 1;
    this.active = false;
    try {
      this.engine.cancel();
    } catch {
      /* nothing to cancel */
    }
  }
}
