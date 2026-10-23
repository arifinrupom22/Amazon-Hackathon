import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudCapture } from "./cloudCapture.js";

function handlers() {
  return {
    listening: vi.fn<() => void>(),
    transcribing: vi.fn<() => void>(),
    final: vi.fn<(text: string) => void>(),
    failure: vi.fn<(failure: unknown) => void>(),
    end: vi.fn<(info: unknown) => void>(),
  };
}


class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);

  state: "inactive" | "recording" = "inactive";
  mimeType = "";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  payload = "recorded speech";

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([this.payload], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;
const getUserMedia = vi.fn(async () => stream);

function create(transcribe = vi.fn(async (_audio: Blob, _language: string) => "Add oat milk")) {
  const calls = handlers();
  const capture = new CloudCapture({
    language: "en-US",
    transcribe,
    handlers: {
      onListening: () => calls.listening(),
      onTranscribing: () => calls.transcribing(),
      onFinal: (text) => calls.final(text),
      onFailure: (failure) => calls.failure(failure),
      onEnd: (info) => calls.end(info),
    },
    mediaDevices: { getUserMedia },
    Recorder: FakeRecorder as unknown as typeof MediaRecorder,
    maxDurationMs: 30_000,
  });
  return { capture, calls, transcribe };
}

beforeEach(() => {
  FakeRecorder.instances = [];
  FakeRecorder.isTypeSupported.mockClear();
  track.stop.mockClear();
  getUserMedia.mockReset().mockResolvedValue(stream);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cloud capture", () => {
  it("records only after start, uploads once, and releases the microphone", async () => {
    const { capture, calls, transcribe } = create();
    expect(getUserMedia).not.toHaveBeenCalled();

    await expect(capture.start()).resolves.toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(calls.listening).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(1);

    capture.stop();
    await vi.waitFor(() => expect(calls.final).toHaveBeenCalledWith("Add oat milk"));
    expect(transcribe).toHaveBeenCalledTimes(1);
    const blob = transcribe.mock.calls[0]?.[0] as unknown as Blob;
    expect(blob.type).toContain("audio/webm");
    expect(calls.transcribing).toHaveBeenCalledTimes(1);
    expect(calls.end).toHaveBeenCalledWith({ hadFinal: true, wasAborted: false });
    expect(track.stop).toHaveBeenCalled();
  });

  it("maps a denied microphone to an actionable permission error", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const { capture, calls, transcribe } = create();

    await expect(capture.start()).resolves.toBe(false);
    expect(calls.listening).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(calls.failure).toHaveBeenCalledWith(
      expect.objectContaining({ code: "not-allowed", title: "Microphone access was denied" }),
    );
  });

  it("reports no speech when the recorder produced no audio", async () => {
    const { capture, calls } = create();
    await capture.start();
    const recorder = FakeRecorder.instances.at(-1)!;
    recorder.payload = "";
    capture.stop();
    await vi.waitFor(() => expect(calls.failure).toHaveBeenCalledWith(expect.objectContaining({ code: "no-speech" })));
    expect(calls.end).toHaveBeenCalled();
  });

  it("keeps the recording usable when transcription fails", async () => {
    const transcribe = vi.fn(async () => {
      throw Object.assign(new Error("quota"), { code: "quota" });
    });
    const { capture, calls } = create(transcribe);
    await capture.start();
    capture.stop();
    await vi.waitFor(() => expect(calls.failure).toHaveBeenCalledWith(expect.objectContaining({ code: "quota" })));
    expect(calls.final).not.toHaveBeenCalled();
    expect(calls.end).toHaveBeenCalledWith({ hadFinal: false, wasAborted: false });
    expect(track.stop).toHaveBeenCalled();
  });

  it("aborts without uploading and releases the microphone", async () => {
    const { capture, calls, transcribe } = create();
    await capture.start();
    capture.abort();
    expect(transcribe).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(capture.isActive).toBe(false);
    expect(calls.final).not.toHaveBeenCalled();
  });

  it("stops automatically at the maximum duration", async () => {
    vi.useFakeTimers();
    const { capture, calls } = create();
    await capture.start();
    vi.advanceTimersByTime(30_001);
    vi.useRealTimers();
    await vi.waitFor(() => expect(calls.transcribing).toHaveBeenCalled());
    expect(capture.isActive).toBe(false);
  });
});
