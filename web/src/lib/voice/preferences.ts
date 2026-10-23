import { isSpeechInputProvider, isVoiceLanguage, type VoicePreferences } from "./types.js";

export const VOICE_PREFERENCES_KEY = "homepilot.voice.preferences.v1";

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  language: "en-US",
  inputProvider: "browser",
  handsFree: false,
  autoSpeak: false,
  rate: 1,
  volume: 1,
  voiceURI: null,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(max, Math.max(min, parsed)) * 100) / 100;
}

/**
 * Accept only validated values. A corrupted localStorage entry must never
 * break the assistant or produce an invalid speech rate.
 */
export function normalizeVoicePreferences(input: unknown): VoicePreferences {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    language: isVoiceLanguage(raw.language) ? raw.language : DEFAULT_VOICE_PREFERENCES.language,
    inputProvider: isSpeechInputProvider(raw.inputProvider)
      ? raw.inputProvider
      : DEFAULT_VOICE_PREFERENCES.inputProvider,
    handsFree: raw.handsFree === true,
    autoSpeak: raw.autoSpeak === true,
    rate: clampNumber(raw.rate, 0.7, 1.3, DEFAULT_VOICE_PREFERENCES.rate),
    volume: clampNumber(raw.volume, 0, 1, DEFAULT_VOICE_PREFERENCES.volume),
    voiceURI:
      typeof raw.voiceURI === "string" && raw.voiceURI.length > 0 && raw.voiceURI.length <= 300
        ? raw.voiceURI
        : null,
  };
}

function resolveStorage(storage?: Pick<Storage, "getItem"> | null): Pick<Storage, "getItem"> | null {
  if (storage !== undefined) return storage;
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Privacy mode / blocked storage: preferences simply stay in memory.
    return null;
  }
}

export function loadVoicePreferences(storage?: Pick<Storage, "getItem"> | null): VoicePreferences {
  const target = resolveStorage(storage);
  if (!target) return { ...DEFAULT_VOICE_PREFERENCES };
  try {
    const raw = target.getItem(VOICE_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_VOICE_PREFERENCES };
    return normalizeVoicePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES };
  }
}

export function saveVoicePreferences(
  preferences: VoicePreferences,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  const target =
    storage !== undefined
      ? storage
      : (() => {
          try {
            return typeof window === "undefined" ? null : window.localStorage;
          } catch {
            return null;
          }
        })();
  if (!target) return;
  try {
    // Hands-free listening is deliberately not persisted: each page load needs
    // a fresh, explicit opt-in before the microphone can be opened automatically.
    target.setItem(
      VOICE_PREFERENCES_KEY,
      JSON.stringify({ ...normalizeVoicePreferences(preferences), handsFree: false }),
    );
  } catch {
    // Quota or security errors are non-fatal; the current session still works.
  }
}
