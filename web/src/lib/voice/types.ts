/** Shared types for the browser-native voice layer. */

export type VoiceLanguage = "en-US" | "bn-BD";

export interface VoiceLanguageOption {
  id: VoiceLanguage;
  label: string;
  nativeLabel: string;
  note?: string;
}

export const VOICE_LANGUAGES: readonly VoiceLanguageOption[] = [
  {
    id: "en-US",
    label: "English",
    nativeLabel: "English (US)",
    note: "Widely supported by speech recognition.",
  },
  {
    id: "bn-BD",
    label: "Bengali",
    nativeLabel: "বাংলা (বাংলাদেশ)",
    note: "Recognition and voices depend on your browser and operating system.",
  },
] as const;

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === "en-US" || value === "bn-BD";
}

export function voiceLanguageOption(language: VoiceLanguage): VoiceLanguageOption {
  return VOICE_LANGUAGES.find((option) => option.id === language) ?? VOICE_LANGUAGES[0]!;
}

export type SpeechInputProvider = "browser" | "google";

export interface VoicePreferences {
  language: VoiceLanguage;
  /** Where speech becomes text. Google means an explicit upload to this server. */
  inputProvider: SpeechInputProvider;
  /** Opt-in continuous turn-taking: listen, answer, speak, listen again. */
  handsFree: boolean;
  autoSpeak: boolean;
  /** 0.7 – 1.3, matching typical browser speech defaults. */
  rate: number;
  /** 0 – 1. */
  volume: number;
  /** voiceURI of the chosen system voice, or null for automatic selection. */
  voiceURI: string | null;
}

export type VoiceStatus =
  | "unsupported"
  | "idle"
  | "requesting"
  | "listening"
  | "processing"
  | "recognized"
  | "stopped"
  | "error";

export interface VoiceFailure {
  code: string;
  title: string;
  message: string;
  retryable: boolean;
}

export interface VoiceSupport {
  supported: boolean;
  reason: string | null;
}

export function isSpeechInputProvider(value: unknown): value is SpeechInputProvider {
  return value === "browser" || value === "google";
}
