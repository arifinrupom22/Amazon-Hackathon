import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../lib/types.js";
import type {
  SpeechRecognitionLike,
  SpeechRecognitionResultListLike,
} from "../lib/voice/recognition.js";
import type { VoicePreferences } from "../lib/voice/types.js";

/* -------------------------------------------------------------------------- */
/* Controllable app state                                                     */
/* -------------------------------------------------------------------------- */

const appState = vi.hoisted(() => ({
  proposePlan: vi.fn(),
  setView: vi.fn(),
  setActivePlan: vi.fn(),
  notify: vi.fn(),
  updateVoice: vi.fn(),
  runTool: vi.fn(),
  cancelPlan: vi.fn(),
  refreshAll: vi.fn(),
  voice: {
    language: "en-US",
    autoSpeak: true,
    rate: 1,
    volume: 1,
    voiceURI: null,
  } as VoicePreferences,
  plans: [] as Plan[],
}));

vi.mock("../state/store", () => ({
  useAppState: () => ({
    proposePlan: appState.proposePlan,
    setView: appState.setView,
    setActivePlan: appState.setActivePlan,
    notify: appState.notify,
    updateVoice: appState.updateVoice,
    runTool: appState.runTool,
    cancelPlan: appState.cancelPlan,
    refreshAll: appState.refreshAll,
    voice: appState.voice,
    status: null,
    plans: appState.plans,
  }),
}));

// The Activity panels read the full store; they are irrelevant here.
vi.mock("../components/Activity", () => ({
  ActivityFeed: () => null,
  McpTracePanel: () => null,
}));

const { Assistant } = await import("./Assistant.js");

/* -------------------------------------------------------------------------- */
/* Browser voice mocks                                                        */
/* -------------------------------------------------------------------------- */

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
  aborted = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.onstart?.();
  }

  stop(): void {
    this.onend?.();
  }

  abort(): void {
    this.aborted = true;
    this.onend?.();
  }
}

class FakeUtterance {
  lang = "";
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor(readonly text: string) {}
}

const spoken: FakeUtterance[] = [];
const synth = {
  speak: vi.fn((utterance: FakeUtterance) => {
    spoken.push(utterance);
  }),
  cancel: vi.fn(),
  getVoices: vi.fn(() => [{ voiceURI: "voice-en", name: "Test English", lang: "en-US", default: true }]),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

function installBrowserApis() {
  Object.defineProperty(window, "SpeechRecognition", {
    value: FakeRecognition,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    configurable: true,
    writable: true,
  });
}

function results(text: string): SpeechRecognitionResultListLike {
  return [{ isFinal: true, length: 1, 0: { transcript: text, confidence: 0.94 } }] as unknown as SpeechRecognitionResultListLike;
}

const plan: Plan = {
  id: "plan_1",
  title: "Groceries for Saturday",
  requestText: "Add oat milk and lemons to the grocery list",
  summary: "Two grocery items are staged for Saturday.",
  assumptions: [],
  clarification: null,
  warnings: [],
  actions: [
    {
      id: "a1",
      tool: "add_grocery_item",
      args: { name: "Oat milk" },
      label: "Add oat milk",
      detail: null,
      domain: "groceries",
      apply: true,
      status: "pending",
      result: null,
    },
    {
      id: "a2",
      tool: "add_grocery_item",
      args: { name: "Lemons" },
      label: "Add lemons",
      detail: null,
      domain: "groceries",
      apply: true,
      status: "pending",
      result: null,
    },
  ],
  status: "proposed",
  provider: "google",
  providerMode: "live",
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
};

beforeEach(() => {
  FakeRecognition.instances = [];
  spoken.length = 0;
  appState.proposePlan.mockReset().mockResolvedValue(plan);
  appState.setView.mockReset();
  appState.setActivePlan.mockReset();
  appState.notify.mockReset();
  appState.runTool.mockReset();
  appState.cancelPlan.mockReset().mockResolvedValue(undefined);
  appState.refreshAll.mockReset().mockResolvedValue(undefined);
  appState.voice = { language: "en-US", inputProvider: "browser", handsFree: false, autoSpeak: true, rate: 1, volume: 1, voiceURI: null };
  appState.plans = [plan];
  synth.speak.mockClear();
  synth.cancel.mockClear();
  // jsdom does not implement scrolling on elements.
  Element.prototype.scrollTo = vi.fn();
  installBrowserApis();
});

describe("Assistant — voice requests use the shared plan workflow", () => {
  it("sends recognized speech through proposePlan and opens the same plan review", async () => {
    render(<Assistant />);

    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    const recognition = FakeRecognition.instances.at(-1)!;
    act(() => {
      recognition.onresult?.({ resultIndex: 0, results: results("Add oat milk and lemons to the grocery list") });
      recognition.onend?.();
    });

    const textarea = screen.getByLabelText("Household request") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Add oat milk and lemons to the grocery list");

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(appState.proposePlan).toHaveBeenCalledWith("Add oat milk and lemons to the grocery list"));
    expect((await screen.findAllByText("Review the proposed plan")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Two grocery items are staged for Saturday.").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("Review the proposed plan").at(-1)!);
    expect(appState.setView).toHaveBeenCalledWith("review");
    expect(appState.setActivePlan).toHaveBeenCalledWith(plan);

    // The composer is ready for the next request.
    await waitFor(() => expect((screen.getByLabelText("Household request") as HTMLTextAreaElement).value).toBe(""));
  });

  it("answers a read-only command through MCP without creating a plan", async () => {
    appState.runTool.mockResolvedValue({
      counts: { openTasks: 2, groceriesToBuy: 1 },
      today: {
        tasks: [{ title: "Refill inhaler" }],
        events: [{ title: "Dinner", date: "2026-10-23", startTime: "19:00" }],
      },
    });
    render(<Assistant />);
    fireEvent.change(screen.getByLabelText("Household request"), {
      target: { value: "What do I need to do today?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(appState.runTool).toHaveBeenCalledWith("get_household_summary"));
    expect(appState.proposePlan).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/2 open tasks/i)).length).toBeGreaterThan(0);
  });

  it("marks a purchased item through a real MCP command and refreshes", async () => {
    appState.runTool.mockImplementation(async (name: string) => {
      if (name === "list_grocery_items") return { items: [{ id: "g1", name: "Milk", purchased: false }] };
      return { item: { id: "g1", name: "Milk", purchased: true } };
    });
    render(<Assistant />);
    fireEvent.change(screen.getByLabelText("Household request"), { target: { value: "I already bought milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(appState.runTool).toHaveBeenCalledWith("mark_grocery_item_purchased", { id: "g1", purchased: true }),
    );
    expect(appState.refreshAll).toHaveBeenCalled();
    expect(appState.proposePlan).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/Marked “Milk” as purchased/i)).length).toBeGreaterThan(0);
  });

  it("speaks a newly proposed plan when automatic replies are enabled", async () => {
    render(<Assistant />);
    fireEvent.change(screen.getByLabelText("Household request"), { target: { value: "Add oat milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(synth.speak).toHaveBeenCalled());
    const text = spoken.map((utterance) => utterance.text).join(" ");
    expect(text).toContain("Two grocery items are staged for Saturday.");
    expect(text).toContain("I prepared 2 actions for your review.");
    // The notice and provider diagnostics are visual only, never spoken.
    expect(text).not.toMatch(/API credits|fallback|GEMINI|RESOURCE_EXHAUSTED/i);
  });

  it("shows the measured proposal latency on the plan card", async () => {
    render(<Assistant />);
    fireEvent.change(screen.getByLabelText("Household request"), { target: { value: "Add oat milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    const button = (await screen.findAllByRole("button", { name: /Review the proposed plan/ })).at(-1)!;
    // A real, non-negative wall-clock measurement is rendered next to the label.
    expect(button.textContent).toMatch(/\d+\.\ds/);
  });

  it("stays silent by default when automatic replies are disabled, and can read on demand", async () => {
    appState.voice = { language: "en-US", inputProvider: "browser", handsFree: false, autoSpeak: false, rate: 1, volume: 1, voiceURI: null };
    render(<Assistant />);
    fireEvent.change(screen.getByLabelText("Household request"), { target: { value: "Add oat milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(appState.proposePlan).toHaveBeenCalledTimes(1));
    await screen.findAllByText("Review the proposed plan");
    expect(synth.speak).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Read aloud" }).at(-1)!);
    await waitFor(() => expect(synth.speak).toHaveBeenCalled());
    expect(spoken.map((utterance) => utterance.text).join(" ")).toContain("Two grocery items are staged for Saturday.");
  });

  it("does not speak a restored conversation on mount", async () => {
    const first = render(<Assistant />);
    fireEvent.change(screen.getByLabelText("Household request"), { target: { value: "Add lemons" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(synth.speak).toHaveBeenCalled());

    // Navigating away and back restores the thread; it must stay silent.
    first.unmount();
    synth.speak.mockClear();
    render(<Assistant />);
    expect(screen.getAllByRole("button", { name: "Read aloud" }).length).toBeGreaterThan(0);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("releases the microphone and speech channel when leaving the conversation", async () => {
    const view = render(<Assistant />);
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    const recognition = FakeRecognition.instances.at(-1)!;
    expect(recognition.aborted).toBe(false);

    view.unmount();
    expect(recognition.aborted).toBe(true);
    expect(synth.cancel).toHaveBeenCalled();
  });
});
