import { describe, expect, it, vi } from "vitest";
import {
  SpeechQueue,
  describeSpeechError,
  sanitizeForSpeech,
  selectVoice,
  speechSynthesisSupport,
  splitForSpeech,
  type SpeechEngine,
} from "./synthesis.js";

class FakeUtterance {
  lang = "";
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;

  constructor(readonly text: string) {}
}

class FakeEngine implements SpeechEngine {
  spoken: FakeUtterance[] = [];
  cancelCount = 0;

  speak(utterance: SpeechSynthesisUtterance): void {
    this.spoken.push(utterance as unknown as FakeUtterance);
  }

  cancel(): void {
    this.cancelCount += 1;
  }
}

function createQueue() {
  const engine = new FakeEngine();
  const queue = new SpeechQueue(
    engine,
    (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
  );
  return { engine, queue };
}

const options = (overrides: Partial<Parameters<SpeechQueue["speak"]>[1]> = {}) => ({
  rate: 1,
  volume: 1,
  lang: "en-US",
  voice: null,
  onEnd: vi.fn(),
  onError: vi.fn(),
  ...overrides,
});

describe("speech support", () => {
  it("does not claim support without both APIs", () => {
    expect(speechSynthesisSupport({}).supported).toBe(false);
    expect(speechSynthesisSupport({ speechSynthesis: {} }).supported).toBe(false);
    expect(
      speechSynthesisSupport({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} }).supported,
    ).toBe(true);
  });
});

describe("sanitizeForSpeech", () => {
  it("removes code, URLs, credentials and HTTP noise", () => {
    const text = sanitizeForSpeech(
      "Here is the plan:\n```json\n{\"key\":\"value\"}\n```\nSee https://example.com and key AIzaABCDEF1234567890 with HTTP 429 GEMINI_API_KEY.",
    );
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/AIza/);
    expect(text).not.toMatch(/429/);
    expect(text).not.toMatch(/GEMINI_API_KEY/);
    expect(text).toMatch(/Here is the plan/);
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeForSpeech("   ")).toBe("");
  });
});

describe("splitForSpeech", () => {
  it("keeps chunks short and preserves sentences", () => {
    const long = `${"Add groceries for dinner.".repeat(10)} ${"Schedule cleaning in the afternoon.".repeat(8)}`;
    const chunks = splitForSpeech(long, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.join(" ")).toContain("Add groceries for dinner.");
    expect(chunks.join(" ")).toContain("Schedule cleaning");
  });

  it("splits a single long sentence at word boundaries", () => {
    const chunks = splitForSpeech("word ".repeat(80), 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 60)).toBe(true);
  });

  it("returns no chunks for blank input", () => {
    expect(splitForSpeech("```code```")).toEqual([]);
  });
});

describe("selectVoice", () => {
  const voices = [
    { voiceURI: "gb", name: "British", lang: "en-GB" },
    { voiceURI: "us", name: "American", lang: "en-US" },
    { voiceURI: "bn", name: "Bangla", lang: "bn-BD" },
    { voiceURI: "fallback", name: "Default", lang: "de-DE", default: true },
  ];

  it("prefers the explicitly chosen voice", () => {
    expect(selectVoice(voices, "en-US", "gb")?.voiceURI).toBe("gb");
  });

  it("falls back to an exact language, then the base language", () => {
    expect(selectVoice(voices, "bn-BD", null)?.voiceURI).toBe("bn");
    expect(selectVoice(voices, "en-AU", null)?.voiceURI).toBe("gb");
  });

  it("uses the browser default when no language matches and returns null with no voices", () => {
    expect(selectVoice(voices, "fr-FR", null)?.voiceURI).toBe("fallback");
    expect(selectVoice([], "en-US", null)).toBeNull();
  });
});

describe("speech error copy", () => {
  it("stays silent for intentional cancellation", () => {
    expect(describeSpeechError("canceled")).toBeNull();
    expect(describeSpeechError("interrupted")).toBeNull();
  });

  it("explains blocked audio and unavailable voices", () => {
    expect(describeSpeechError("not-allowed")).toMatch(/blocked audio/i);
    expect(describeSpeechError("voice-unavailable")).toMatch(/voice/i);
  });
});

describe("SpeechQueue", () => {
  it("plays one chunk at a time and completes", () => {
    const { engine, queue } = createQueue();
    const onEnd = vi.fn();
    const started = queue.speak("Plan for Saturday. Add groceries for dinner.", options({ onEnd }));
    expect(started).toBe(true);
    expect(engine.spoken).toHaveLength(1);
    expect(engine.spoken[0]!.lang).toBe("en-US");
    expect(engine.spoken[0]!.rate).toBe(1);

    engine.spoken[0]!.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(queue.isActive).toBe(false);
  });

  it("splits long text into sequential utterances", () => {
    const { engine, queue } = createQueue();
    const long = `${"A".repeat(200)} ${"B".repeat(200)}.`;
    queue.speak(long, options());
    const first = engine.spoken[0]!;
    expect(first.text.length).toBeLessThanOrEqual(220);
    first.onend?.();
    expect(engine.spoken.length).toBeGreaterThan(1);
  });

  it("cancels a previous answer when a new one starts", () => {
    const { engine, queue } = createQueue();
    const first = options();
    queue.speak("First answer.", first);
    const firstUtterance = engine.spoken[0]!;

    queue.speak("Second answer.", options());
    expect(engine.cancelCount).toBeGreaterThanOrEqual(2);
    // A stale end event must not complete the new response.
    firstUtterance.onend?.();
    expect(first.onEnd).not.toHaveBeenCalled();
    expect(engine.spoken.at(-1)!.text).toBe("Second answer.");
  });

  it("stops playback and ignores pending completion", () => {
    const { engine, queue } = createQueue();
    const onEnd = vi.fn();
    queue.speak("Read this.", options({ onEnd }));
    const utterance = engine.spoken[0]!;
    queue.stop();
    utterance.onend?.();
    expect(onEnd).not.toHaveBeenCalled();
    expect(queue.isActive).toBe(false);
  });

  it("reports synthesis errors without throwing", () => {
    const { engine, queue } = createQueue();
    const onError = vi.fn();
    queue.speak("Read this.", options({ onError }));
    engine.spoken[0]!.onerror?.({ error: "synthesis-failed" });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/isn't available|written answer/i));
    expect(queue.isActive).toBe(false);
  });

  it("returns false when there is nothing to say", () => {
    const { queue } = createQueue();
    expect(queue.speak("``` ```", options())).toBe(false);
  });
});
