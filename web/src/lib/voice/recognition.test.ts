import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecognitionSession,
  describeRecognitionError,
  extractTranscript,
  getRecognitionCtor,
  mergeTranscript,
  normalizeTranscript,
  recognitionSupport,
  type SpeechRecognitionCtor,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultEventLike,
  type SpeechRecognitionResultListLike,
} from "./recognition.js";

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];

  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  aborted = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.started = true;
    this.onstart?.();
  }

  stop(): void {
    this.stopped = true;
    this.onend?.();
  }

  abort(): void {
    this.aborted = true;
    this.onend?.();
  }
}

function resultList(items: Array<{ text: string; final: boolean }>): SpeechRecognitionResultListLike {
  const list = items.map((item) => ({
    isFinal: item.final,
    length: 1,
    0: { transcript: item.text, confidence: 0.9 },
  }));
  return list as unknown as SpeechRecognitionResultListLike;
}

function createSession(language: "en-US" | "bn-BD" = "en-US") {
  const calls = {
    listening: vi.fn(),
    interim: vi.fn(),
    final: vi.fn(),
    failure: vi.fn(),
    end: vi.fn(),
    retry: vi.fn(),
  };
  const session = new RecognitionSession(
    FakeRecognition as unknown as SpeechRecognitionCtor,
    language,
    {
      onListening: calls.listening,
      onInterim: calls.interim,
      onFinal: calls.final,
      onFailure: calls.failure,
      onEnd: calls.end,
      onRetry: calls.retry,
    },
  );
  return { session, calls };
}

afterEach(() => {
  FakeRecognition.instances = [];
});

describe("recognition detection", () => {
  it("returns null when the browser exposes no recognizer", () => {
    expect(getRecognitionCtor(null)).toBeNull();
    expect(getRecognitionCtor({})).toBeNull();
    expect(recognitionSupport({}).supported).toBe(false);
    expect(recognitionSupport({}).reason).toMatch(/Chrome or Edge/i);
  });

  it("accepts both the standard and webkit constructors", () => {
    expect(getRecognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(getRecognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionSupport({ SpeechRecognition: FakeRecognition })).toEqual({
      supported: true,
      reason: null,
    });
  });
});

describe("transcript handling", () => {
  it("normalizes whitespace and merges overlapping results without duplication", () => {
    expect(normalizeTranscript("  plan   saturday ")).toBe("plan saturday");
    expect(mergeTranscript("", "add milk")).toBe("add milk");
    expect(mergeTranscript("add", "add milk")).toBe("add milk");
    expect(mergeTranscript("add milk", "milk")).toBe("add milk");
    expect(mergeTranscript("add", "milk")).toBe("add milk");
  });

  it("separates final and interim results from the event index", () => {
    const results = resultList([
      { text: "plan saturday", final: true },
      { text: "and buy", final: false },
    ]);
    expect(extractTranscript(results, 0)).toEqual({ final: "plan saturday", interim: "and buy" });
    expect(extractTranscript(results, 1)).toEqual({ final: "", interim: "and buy" });
  });
});

describe("recognition errors", () => {
  it("maps permission denial to an actionable, retryable state", () => {
    const failure = describeRecognitionError("not-allowed", "en-US");
    expect(failure?.title).toMatch(/denied/i);
    expect(failure?.message).toMatch(/allow microphone/i);
    expect(failure?.retryable).toBe(true);
  });

  it("handles silence and missing microphones", () => {
    expect(describeRecognitionError("no-speech", "en-US")?.title).toMatch(/didn't hear/i);
    expect(describeRecognitionError("audio-capture", "en-US")?.title).toMatch(/no microphone/i);
  });

  it("explains unavailable Bengali without pretending it works", () => {
    const failure = describeRecognitionError("language-not-supported", "bn-BD");
    expect(failure?.title).toMatch(/Bengali/i);
    expect(failure?.retryable).toBe(false);
  });

  it("treats an intentional abort as no error", () => {
    expect(describeRecognitionError("aborted", "en-US")).toBeNull();
  });
});

describe("recognition session", () => {
  it("configures the recognizer for the chosen language and reports listening", () => {
    const { session, calls } = createSession("bn-BD");
    expect(session.start()).toBe(true);
    const recognition = FakeRecognition.instances.at(-1)!;
    expect(recognition.lang).toBe("bn-BD");
    expect(recognition.interimResults).toBe(true);
    expect(recognition.continuous).toBe(false);
    expect(recognition.started).toBe(true);
    expect(calls.listening).toHaveBeenCalledTimes(1);
    expect(session.isActive).toBe(true);
  });

  it("refuses a second concurrent session", () => {
    const { session } = createSession();
    expect(session.start()).toBe(true);
    expect(session.start()).toBe(false);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("emits interim text and accumulates final speech", () => {
    const { session, calls } = createSession();
    session.start();
    const recognition = FakeRecognition.instances.at(-1)!;

    recognition.onresult?.({
      resultIndex: 0,
      results: resultList([{ text: "plan a relaxed", final: false }]),
    });
    expect(calls.interim).toHaveBeenCalledWith("plan a relaxed");

    recognition.onresult?.({
      resultIndex: 0,
      results: resultList([{ text: "plan a relaxed saturday", final: true }]),
    });
    expect(calls.final).toHaveBeenCalledWith("plan a relaxed saturday");
  });

  it("reports permission failure and finishes cleanly", () => {
    const { session, calls } = createSession();
    session.start();
    const recognition = FakeRecognition.instances.at(-1)!;

    recognition.onerror?.({ error: "not-allowed" });
    expect(calls.failure).toHaveBeenCalledWith(expect.objectContaining({ code: "not-allowed" }));

    recognition.onend?.();
    expect(calls.end).toHaveBeenCalledWith({ hadFinal: false, wasAborted: true });
    expect(session.isActive).toBe(false);
  });

  it("stops gracefully so a final result can arrive", () => {
    const { session } = createSession();
    session.start();
    const recognition = FakeRecognition.instances.at(-1)!;
    session.stop();
    expect(recognition.stopped).toBe(true);
    expect(session.isActive).toBe(false);
  });

  it("retries a network failure exactly once, then explains it without claiming the user is offline", () => {
    vi.useFakeTimers();
    try {
      const { session, calls } = createSession();
      session.start();
      const first = FakeRecognition.instances.at(-1)!;

      first.onerror?.({ error: "network" });
      first.onend?.();
      expect(calls.retry).toHaveBeenCalledWith(1);
      expect(calls.failure).not.toHaveBeenCalled();
      expect(calls.end).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(FakeRecognition.instances).toHaveLength(2);

      const second = FakeRecognition.instances.at(-1)!;
      second.onerror?.({ error: "network" });
      second.onend?.();

      expect(FakeRecognition.instances).toHaveLength(2);
      expect(calls.failure).toHaveBeenCalledWith(expect.objectContaining({ code: "network" }));
      const failure = calls.failure.mock.calls[0]?.[0] as { title: string; message: string };
      expect(failure.title).not.toMatch(/offline/i);
      expect(failure.message).not.toContain("Check your connection");
      expect(failure.message).toMatch(/does not mean your internet is offline/i);
      expect(calls.end).toHaveBeenCalledWith({ hadFinal: false, wasAborted: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-enter listening when the recognizer starts after a stop", () => {
    const { session, calls } = createSession();
    session.start();
    const recognition = FakeRecognition.instances.at(-1)!;
    expect(calls.listening).toHaveBeenCalledTimes(1);

    // The user pressed stop while the permission prompt was still open; the
    // engine opening afterwards must not resurrect the listening state.
    session.stop();
    recognition.onstart?.();
    expect(calls.listening).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately when the UI is torn down", () => {
    const { session } = createSession();
    session.start();
    const recognition = FakeRecognition.instances.at(-1)!;
    session.abort();
    expect(recognition.aborted).toBe(true);
    expect(session.isActive).toBe(false);
  });

  it("fails safely when the constructor throws", () => {
    const Throwing = class {
      constructor() {
        throw new Error("no microphone");
      }
    } as unknown as SpeechRecognitionCtor;

    const failure = vi.fn();
    const session = new RecognitionSession(Throwing, "en-US", {
      onListening: vi.fn(),
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onFailure: failure,
      onEnd: vi.fn(),
    });

    expect(session.start()).toBe(false);
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ code: "start-failed" }));
  });
});
