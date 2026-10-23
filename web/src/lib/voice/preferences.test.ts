import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_PREFERENCES,
  VOICE_PREFERENCES_KEY,
  loadVoicePreferences,
  normalizeVoicePreferences,
  saveVoicePreferences,
} from "./preferences.js";

function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe("voice preferences", () => {
  it("returns safe defaults for corrupted or hostile input", () => {
    for (const input of [null, undefined, "nope", 42, [], {}]) {
      const prefs = normalizeVoicePreferences(input);
      expect(prefs.language).toBe("en-US");
      expect(prefs.autoSpeak).toBe(false);
      expect(prefs.rate).toBe(1);
      expect(prefs.volume).toBe(1);
      expect(prefs.voiceURI).toBeNull();
    }
  });

  it("clamps rate and volume and validates the language", () => {
    const prefs = normalizeVoicePreferences({
      language: "bn-BD",
      autoSpeak: true,
      rate: 5,
      volume: -1,
      voiceURI: "voice-1",
    });
    expect(prefs).toEqual({
      language: "bn-BD",
      inputProvider: "browser",
      handsFree: false,
      autoSpeak: true,
      rate: 1.3,
      volume: 0,
      voiceURI: "voice-1",
    });

    expect(normalizeVoicePreferences({ language: "xx-YY", rate: 0.1 }).language).toBe("en-US");
    expect(normalizeVoicePreferences({ rate: 0.1 }).rate).toBe(0.7);
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    saveVoicePreferences({ ...DEFAULT_VOICE_PREFERENCES, language: "bn-BD", autoSpeak: true }, storage);
    expect(storage.dump()[VOICE_PREFERENCES_KEY]).toContain("bn-BD");
    expect(loadVoicePreferences(storage)).toMatchObject({ language: "bn-BD", autoSpeak: true });
  });

  it("never restores hands-free listening across a page load", () => {
    const storage = memoryStorage();
    saveVoicePreferences(
      {
        ...DEFAULT_VOICE_PREFERENCES,
        handsFree: true,
        autoSpeak: true,
        inputProvider: "google",
      },
      storage,
    );
    const restored = loadVoicePreferences(storage);
    expect(restored.handsFree).toBe(false);
    expect(restored.inputProvider).toBe("google");
    expect(restored.autoSpeak).toBe(true);
  });

  it("survives invalid JSON and unavailable storage", () => {
    expect(loadVoicePreferences(memoryStorage({ [VOICE_PREFERENCES_KEY]: "{oops" }))).toEqual(
      DEFAULT_VOICE_PREFERENCES,
    );
    expect(loadVoicePreferences(null)).toEqual(DEFAULT_VOICE_PREFERENCES);
    expect(() => saveVoicePreferences(DEFAULT_VOICE_PREFERENCES, null)).not.toThrow();
  });
});
