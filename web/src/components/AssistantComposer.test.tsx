import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantComposer } from "./AssistantComposer.js";
import type {
  SpeechRecognitionLike,
  SpeechRecognitionResultListLike,
} from "../lib/voice/recognition.js";

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];

  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultListLike }) => void) | null =
    null;
  onerror: ((event: { error: string; message?: string }) => void) | null = null;
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

function installRecognition() {
  Object.defineProperty(window, "SpeechRecognition", {
    value: FakeRecognition,
    configurable: true,
    writable: true,
  });
}

function results(text: string, final = true): SpeechRecognitionResultListLike {
  return [
    { isFinal: final, length: 1, 0: { transcript: text, confidence: 0.95 } },
  ] as unknown as SpeechRecognitionResultListLike;
}

function renderComposer(overrides: Partial<Parameters<typeof AssistantComposer>[0]> = {}) {
  const onSubmit = vi.fn();
  const onLanguageChange = vi.fn();
  const onProviderChange = vi.fn();
  const onHandsFreeChange = vi.fn();
  const view = render(
    <AssistantComposer
      onSubmit={onSubmit}
      busy={false}
      language="en-US"
      onLanguageChange={onLanguageChange}
      inputProvider="browser"
      onProviderChange={onProviderChange}
      handsFree={false}
      onHandsFreeChange={onHandsFreeChange}
      {...overrides}
    />,
  );
  return { ...view, onSubmit, onLanguageChange, onProviderChange, onHandsFreeChange };
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText("Household request") as HTMLTextAreaElement;
}

beforeEach(() => {
  FakeRecognition.instances = [];
  Reflect.deleteProperty(window, "SpeechRecognition");
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
});

describe("AssistantComposer — unsupported browsers", () => {
  it("explains that voice is unavailable and keeps typing usable", () => {
    const { onSubmit } = renderComposer();
    const mic = screen.getByRole("button", { name: /voice input is not supported/i });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/voice input unavailable/i)).toBeTruthy();

    fireEvent.change(textarea(), { target: { value: "Plan Saturday" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(onSubmit).toHaveBeenCalledWith("Plan Saturday");
    expect(screen.getByText(/voice input unavailable/i)).toBeTruthy();
  });
});

function HandsFreeHarness({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [handsFree, setHandsFree] = useState(false);
  return (
    <AssistantComposer
      onSubmit={onSubmit}
      busy={false}
      language="en-US"
      onLanguageChange={vi.fn()}
      inputProvider="browser"
      onProviderChange={vi.fn()}
      handsFree={handsFree}
      onHandsFreeChange={setHandsFree}
    />
  );
}

class FakeCloudRecorder {
  static instances: FakeCloudRecorder[] = [];
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: unknown, _options?: unknown) {
    FakeCloudRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function installCloudRecorder() {
  const stopTrack = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })),
    },
    configurable: true,
  });
  vi.stubGlobal("MediaRecorder", FakeCloudRecorder);
  return { stopTrack };
}

describe("AssistantComposer — recognition", () => {
  it("starts listening, shows state and places recognized text in the editable field", () => {
    installRecognition();
    const { onSubmit } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    const recognition = FakeRecognition.instances.at(-1)!;
    expect(recognition.started).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Listening");

    act(() => {
      recognition.onresult?.({ resultIndex: 0, results: results("Add oat milk and lemons") });
      recognition.onend?.();
    });

    expect(textarea().value).toBe("Add oat milk and lemons");
    expect(screen.getByText(/speech recognized/i)).toBeTruthy();

    // The recognized text is editable before submission.
    fireEvent.change(textarea(), { target: { value: "Add oat milk, lemons and bread" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Add oat milk, lemons and bread");
    expect(textarea().value).toBe("");
  });

  it("shows interim speech while listening", () => {
    installRecognition();
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    const recognition = FakeRecognition.instances.at(-1)!;

    act(() => {
      recognition.onresult?.({ resultIndex: 0, results: results("plan a relaxed", false) });
    });
    expect(screen.getByRole("status").textContent).toContain("plan a relaxed");
  });

  it("prevents duplicate submissions of the same request", () => {
    installRecognition();
    const { onSubmit } = renderComposer();

    fireEvent.change(textarea(), { target: { value: "Clean the kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    // Re-enter the same text immediately and submit again.
    fireEvent.change(textarea(), { target: { value: "Clean the kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("can stop listening without submitting", () => {
    installRecognition();
    const { onSubmit } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    const recognition = FakeRecognition.instances.at(-1)!;

    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    expect(recognition.stopped).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Stopped listening");
  });

  it("shows an actionable permission error and allows dismissal", () => {
    installRecognition();
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    const recognition = FakeRecognition.instances.at(-1)!;

    act(() => {
      recognition.onerror?.({ error: "not-allowed" });
      recognition.onend?.();
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Microphone access was denied");
    expect(alert.textContent).toContain("Allow microphone access");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("passes the selected language to the recognizer", () => {
    installRecognition();
    const { rerender, onLanguageChange } = renderComposer();
    fireEvent.change(screen.getByLabelText("Voice language"), { target: { value: "bn-BD" } });
    expect(onLanguageChange).toHaveBeenCalledWith("bn-BD");

    rerender(
      <AssistantComposer
        onSubmit={vi.fn()}
        busy={false}
        language="bn-BD"
        onLanguageChange={onLanguageChange}
        inputProvider="browser"
        onProviderChange={vi.fn()}
        handsFree={false}
        onHandsFreeChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    expect(FakeRecognition.instances.at(-1)!.lang).toBe("bn-BD");
  });

  it("does not start while a request is in flight", () => {
    installRecognition();
    renderComposer({ busy: true });
    const mic = screen.getByRole("button", { name: "Start voice input" });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it("records explicitly and fills the transcript with cloud transcription", async () => {
    const { stopTrack } = installCloudRecorder();
    const transcribe = vi.fn(async () => "Add oat milk and lemons");
    renderComposer({ inputProvider: "google", cloudAvailable: true, transcribe });

    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    await screen.findByText("Recording — press stop");
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));

    await waitFor(() => expect(textarea().value).toBe("Add oat milk and lemons"));
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByLabelText("Household request")).toBeTruthy();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("auto-sends in hands-free mode and shows the persistent indicator", async () => {
    installRecognition();
    const onSubmit = vi.fn();
    render(<HandsFreeHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Start hands-free conversation" }));
    expect(screen.getByLabelText("Household request")).toBeTruthy();
    const recognition = FakeRecognition.instances.at(-1)!;
    act(() => {
      recognition.onresult?.({ resultIndex: 0, results: results("What do I need today") });
      recognition.onend?.();
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("What do I need today"), { timeout: 2500 });
    expect(screen.getByRole("button", { name: "Pause hands-free conversation" })).toBeTruthy();
  });

  it("pausing hands-free stops the microphone without sending", () => {
    installRecognition();
    const onSubmit = vi.fn();
    render(<HandsFreeHarness onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Start hands-free conversation" }));

    fireEvent.click(screen.getByRole("button", { name: "Pause hands-free conversation" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start hands-free conversation" })).toBeTruthy();
  });
});
