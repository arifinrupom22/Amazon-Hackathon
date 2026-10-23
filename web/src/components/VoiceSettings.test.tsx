import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceSettings } from "./VoiceSettings.js";
import { DEFAULT_VOICE_PREFERENCES } from "../lib/voice/preferences.js";
import type { SpeechOutputController } from "../hooks/useSpeechOutput.js";
import type { VoicePreferences } from "../lib/voice/types.js";

const voices = [
  {
    voiceURI: "us",
    name: "Samantha",
    lang: "en-US",
    default: true,
    localService: true,
  },
  {
    voiceURI: "bn",
    name: "Bangla",
    lang: "bn-BD",
    default: false,
    localService: true,
  },
] as unknown as SpeechSynthesisVoice[];

function makeSpeech(overrides: Partial<SpeechOutputController> = {}): SpeechOutputController {
  return {
    supported: true,
    supportMessage: null,
    voices,
    speakingId: null,
    error: null,
    speak: vi.fn(() => true),
    stop: vi.fn(),
    toggle: vi.fn(),
    test: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

function renderSettings(
  preferences: VoicePreferences = DEFAULT_VOICE_PREFERENCES,
  speech = makeSpeech(),
  transcription?: { available: boolean; model: string; detail: string },
) {
  const onChange = vi.fn();
  const view = render(
    <VoiceSettings preferences={preferences} onChange={onChange} speech={speech} transcription={transcription} />,
  );
  return { ...view, onChange, speech };
}

describe("VoiceSettings", () => {
  it("toggles automatic spoken replies", () => {
    const { onChange } = renderSettings();
    const toggle = screen.getByRole("switch", { name: "Speak answers automatically" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ autoSpeak: true });
  });

  it("reflects the enabled preference", () => {
    renderSettings({ ...DEFAULT_VOICE_PREFERENCES, autoSpeak: true });
    expect(
      screen.getByRole("switch", { name: "Speak answers automatically" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("lets the user choose an installed voice", () => {
    const { onChange } = renderSettings();
    fireEvent.change(screen.getByLabelText(/Voice · English/), { target: { value: "bn" } });
    expect(onChange).toHaveBeenCalledWith({ voiceURI: "bn" });
  });

  it("updates rate and volume", () => {
    const { onChange } = renderSettings();
    const [rate, volume] = screen.getAllByRole("slider");
    fireEvent.change(rate!, { target: { value: "1.2" } });
    expect(onChange).toHaveBeenCalledWith({ rate: 1.2 });
    fireEvent.change(volume!, { target: { value: "0.4" } });
    expect(onChange).toHaveBeenCalledWith({ volume: 0.4 });
  });

  it("previews and stops the sample voice", () => {
    const { speech, rerender } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Preview voice" }));
    expect(speech.test).toHaveBeenCalledTimes(1);

    rerender(
      <VoiceSettings
        preferences={DEFAULT_VOICE_PREFERENCES}
        onChange={vi.fn()}
        speech={{ ...speech, speakingId: "__voice_test__" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
    expect(speech.stop).toHaveBeenCalled();
  });

  it("disables controls when synthesis is unavailable", () => {
    renderSettings(
      DEFAULT_VOICE_PREFERENCES,
      makeSpeech({ supported: false, supportMessage: "Spoken replies aren't supported in this browser." }),
    );
    expect(screen.getByText("Spoken replies aren't supported in this browser.")).toBeTruthy();
    expect(
      (screen.getByRole("switch", { name: "Speak answers automatically" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Preview voice" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("selects Google transcription only when the server reports it configured", () => {
    const configured = { available: true, model: "gemini-3.5-transcribe", detail: "Short clips." };
    const { onChange, rerender, speech } = renderSettings(DEFAULT_VOICE_PREFERENCES, makeSpeech(), configured);
    fireEvent.change(screen.getByLabelText("Speech input"), { target: { value: "google" } });
    expect(onChange).toHaveBeenCalledWith({ inputProvider: "google" });

    rerender(
      <VoiceSettings
        preferences={{ ...DEFAULT_VOICE_PREFERENCES, inputProvider: "google" }}
        onChange={onChange}
        speech={speech}
        transcription={configured}
      />,
    );
    expect(screen.getByText(/uploaded only when you press the microphone/i)).toBeTruthy();
  });

  it("explains unavailable Google transcription and offers browser speech", () => {
    const { onChange } = renderSettings(
      { ...DEFAULT_VOICE_PREFERENCES, inputProvider: "google" },
      makeSpeech(),
      { available: false, model: "gemini-3.5-transcribe", detail: "Add GEMINI_API_KEY to enable it." },
    );
    expect(screen.getByText("Google transcription (not configured)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use browser speech" }));
    expect(onChange).toHaveBeenCalledWith({ inputProvider: "browser" });
  });

  it("shows hands-free as opt-in for this session only", () => {
    const { rerender } = renderSettings();
    expect(screen.getByText("Off")).toBeTruthy();
    rerender(
      <VoiceSettings
        preferences={{ ...DEFAULT_VOICE_PREFERENCES, handsFree: true }}
        onChange={vi.fn()}
        speech={makeSpeech()}
      />,
    );
    expect(screen.getByText("On this session")).toBeTruthy();
  });

  it("shows a speech error without removing controls", () => {
    const speech = makeSpeech({ error: "Your browser blocked audio playback." });
    renderSettings(DEFAULT_VOICE_PREFERENCES, speech);
    expect(screen.getByText("Your browser blocked audio playback.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(speech.clearError).toHaveBeenCalled();
  });
});
