import { Gauge, Headphones, Loader2, Mic, Square, Volume2 } from "lucide-react";
import type { SpeechOutputController } from "../hooks/useSpeechOutput.js";
import {
  voiceLanguageOption,
  type SpeechInputProvider,
  type VoicePreferences,
} from "../lib/voice/types.js";
import { WarningBanner } from "./ui";

export function VoiceSettings({
  preferences,
  onChange,
  speech,
  transcription,
}: {
  preferences: VoicePreferences;
  onChange: (patch: Partial<VoicePreferences>) => void;
  speech: SpeechOutputController;
  transcription?: { available: boolean; model: string; detail: string };
}) {
  const language = voiceLanguageOption(preferences.language);
  const base = preferences.language.split("-")[0] ?? preferences.language;
  const matching = speech.voices.filter((voice) => voice.lang.toLowerCase().startsWith(base));
  const others = speech.voices.filter((voice) => !matching.includes(voice));
  const ordered = [...matching, ...others];
  const previewing = speech.speakingId === "__voice_test__";

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Voice replies</h3>
          <p className="mt-0.5 text-[11.5px] leading-4 text-muted">Browser speech · nothing recorded or stored</p>
        </div>
        <span className={`chip ${speech.supported ? "chip-accent" : "chip-warning"}`} style={{ height: 20, fontSize: 11 }}>
          {speech.supported ? "Available" : "Unavailable"}
        </span>
      </div>

      {!speech.supported ? (
        <div className="mt-3">
          <WarningBanner tone="info">
            <p>{speech.supportMessage ?? "Spoken replies aren't available in this browser."}</p>
          </WarningBanner>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="speech-provider" className="text-[12px] font-medium text-muted">
            Speech input
          </label>
          <select
            id="speech-provider"
            className="field mt-1 h-9 py-0 text-[13px]"
            value={preferences.inputProvider}
            onChange={(event) => onChange({ inputProvider: event.target.value as SpeechInputProvider })}
          >
            <option value="browser">Browser speech</option>
            <option value="google" disabled={!transcription?.available}>
              Google transcription{transcription?.available ? "" : " (not configured)"}
            </option>
          </select>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            {preferences.inputProvider === "google"
              ? transcription?.available
                ? `${transcription.detail} The recording is uploaded only when you press the microphone.`
                : (transcription?.detail ??
                  "Google transcription is not configured on the server. Add GEMINI_API_KEY there or use browser speech.")
              : "Uses the browser's Web Speech API. Chrome and Edge send recognition audio to their own speech service; HomePilot records and stores nothing."}
          </p>
          {preferences.inputProvider === "google" && !transcription?.available ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-2"
              onClick={() => onChange({ inputProvider: "browser" })}
            >
              <Mic size={13} aria-hidden="true" />
              Use browser speech
            </button>
          ) : null}
        </div>

        <div className="rounded-[8px] border border-line bg-surface-2 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
            <Headphones size={13} className={preferences.handsFree ? "text-accent" : "text-muted"} aria-hidden="true" />
            Hands-free conversation
            <span className={`chip ${preferences.handsFree ? "chip-accent" : ""}`} style={{ height: 18, fontSize: 10 }}>
              {preferences.handsFree ? "On this session" : "Off"}
            </span>
          </p>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            Toggle it with the headphones button beside the microphone. It listens, sends the transcript, speaks the
            answer, then listens again — the microphone is off while HomePilot speaks. It turns off on reload and
            whenever you press Stop or Esc.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="voice-auto-speak" className="text-[13px] font-medium text-ink">
            Speak answers automatically
          </label>
          <button
            id="voice-auto-speak"
            type="button"
            role="switch"
            aria-checked={preferences.autoSpeak}
            aria-label="Speak answers automatically"
            disabled={!speech.supported}
            onClick={() => onChange({ autoSpeak: !preferences.autoSpeak })}
            className={`relative h-[22px] w-[38px] shrink-0 rounded-full border transition ${
              preferences.autoSpeak ? "border-accent bg-accent" : "border-line-strong bg-canvas-deep"
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                preferences.autoSpeak ? "left-[19px]" : "left-[2px]"
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
        <p className="text-[11.5px] leading-4 text-muted">
          {preferences.autoSpeak
            ? "New answers are read aloud. Typed and spoken requests both use this setting."
            : "Answers are silent until you press Read aloud on a message."}
        </p>

        <div>
          <label htmlFor="voice-select" className="text-[12px] font-medium text-muted">
            Voice · {language.label}
          </label>
          <select
            id="voice-select"
            className="field mt-1 h-9 py-0 text-[13px]"
            value={preferences.voiceURI ?? ""}
            disabled={!speech.supported || ordered.length === 0}
            onChange={(event) => onChange({ voiceURI: event.target.value || null })}
          >
            <option value="">Automatic (best match for {language.label})</option>
            {ordered.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} · {voice.lang}
              </option>
            ))}
          </select>
          {ordered.length === 0 ? (
            <p className="mt-1 text-[11px] leading-4 text-muted">
              No installed voices reported yet. The browser will use its default voice; {language.label} playback may
              fall back to another language.
            </p>
          ) : matching.length === 0 ? (
            <p className="mt-1 text-[11px] leading-4 text-muted">
              No {language.label} voice is installed. The default voice may pronounce it with another accent.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-medium text-muted">
            <span className="flex items-center gap-1.5">
              <Gauge size={12} aria-hidden="true" />
              Rate
            </span>
            <input
              type="range"
              min={0.7}
              max={1.3}
              step={0.05}
              value={preferences.rate}
              disabled={!speech.supported}
              onChange={(event) => onChange({ rate: Number(event.target.value) })}
              aria-valuetext={`${preferences.rate.toFixed(2)} times normal speed`}
              className="mt-1.5 h-1.5 w-full cursor-pointer accent-[var(--color-accent)]"
            />
            <span className="tnum mt-0.5 block text-[11px] font-normal text-muted">{preferences.rate.toFixed(2)}×</span>
          </label>
          <label className="text-[12px] font-medium text-muted">
            <span className="flex items-center gap-1.5">
              <Volume2 size={12} aria-hidden="true" />
              Volume
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={preferences.volume}
              disabled={!speech.supported}
              onChange={(event) => onChange({ volume: Number(event.target.value) })}
              aria-valuetext={`${Math.round(preferences.volume * 100)} percent volume`}
              className="mt-1.5 h-1.5 w-full cursor-pointer accent-[var(--color-accent)]"
            />
            <span className="tnum mt-0.5 block text-[11px] font-normal text-muted">
              {Math.round(preferences.volume * 100)}%
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!speech.supported}
            onClick={() => (previewing ? speech.stop() : speech.test())}
          >
            {previewing ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
            {previewing ? "Stop preview" : "Preview voice"}
          </button>
          {speech.speakingId && speech.speakingId !== "__voice_test__" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={speech.stop}>
              <Square size={12} fill="currentColor" aria-hidden="true" />
              Stop reading
            </button>
          ) : null}
          {previewing ? (
            <span className="flex items-center gap-1.5 text-[11.5px] text-accent-strong" aria-live="polite">
              <Loader2 size={11} className="animate-spin" aria-hidden="true" />
              Speaking…
            </span>
          ) : null}
        </div>

        {speech.error ? (
          <WarningBanner tone="warning">
            <p>{speech.error}</p>
            <button type="button" className="text-[12px] font-medium underline" onClick={speech.clearError}>
              Dismiss
            </button>
          </WarningBanner>
        ) : null}

        <p className="text-[11px] leading-4 text-muted">
          Uses the browser&apos;s built-in speech synthesis — not a premium neural voice.{" "}
          {language.id === "bn-BD"
            ? "Bengali quality depends on the voices installed in your operating system."
            : "Quality depends on the voices installed in your browser."}
        </p>
      </div>
    </section>
  );
}
