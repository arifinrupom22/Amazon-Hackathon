import { useEffect, useRef, useState } from "react";
import { ArrowUp, Headphones, Info, Loader2, Mic, Square, Sparkles } from "lucide-react";
import { useVoiceInput } from "../hooks/useVoiceInput.js";
import { api } from "../lib/api.js";
import {
  VOICE_LANGUAGES,
  voiceLanguageOption,
  type SpeechInputProvider,
  type VoiceLanguage,
} from "../lib/voice/types.js";
import { WarningBanner } from "./ui.js";

const HANDS_FREE_REVIEW_MS = 900;

export function AssistantComposer({
  onSubmit,
  busy,
  language,
  onLanguageChange,
  inputProvider,
  onProviderChange,
  cloudAvailable = false,
  handsFree,
  onHandsFreeChange,
  speaking = false,
  placeholder = "Tell HomePilot what's happening…",
  autoFocus = false,
  transcribe,
}: {
  onSubmit: (text: string) => void;
  busy: boolean;
  language: VoiceLanguage;
  onLanguageChange: (language: VoiceLanguage) => void;
  inputProvider: SpeechInputProvider;
  onProviderChange: (provider: SpeechInputProvider) => void;
  cloudAvailable?: boolean;
  handsFree: boolean;
  onHandsFreeChange: (enabled: boolean) => void;
  speaking?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Injectable for tests; defaults to the real server endpoint. */
  transcribe?: (audio: Blob, language: VoiceLanguage) => Promise<string>;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastSent = useRef<{ text: string; at: number } | null>(null);
  const lastSubmitAt = useRef(0);
  const editedRef = useRef(false);
  const handsFreeArmed = useRef(false);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const voice = useVoiceInput({
    language,
    provider: inputProvider,
    cloudAvailable,
    enabled: !busy,
    transcribe: transcribe ?? api.transcribe,
    onTranscript: (text) => {
      editedRef.current = false;
      setValue(text);
    },
  });

  const listening = voice.status === "listening" || voice.status === "requesting";
  const processing = voice.status === "processing";
  const activeLanguage = voiceLanguageOption(language);
  const cloudSelected = inputProvider === "google";

  const resize = () => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(160, node.scrollHeight)}px`;
  };

  const submit = () => {
    const text = valueRef.current.trim();
    if (!text || busy) return;
    const now = Date.now();
    if (lastSent.current && lastSent.current.text === text && now - lastSent.current.at < 1500) return;
    lastSent.current = { text, at: now };
    lastSubmitAt.current = now;
    editedRef.current = false;
    if (listening || processing) voice.stop();
    onSubmit(text);
    setValue("");
    voice.reset();
    if (ref.current) ref.current.style.height = "auto";
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const pauseHandsFree = () => {
    handsFreeArmed.current = false;
    onHandsFreeChange(false);
  };

  const toggleMic = () => {
    if (!voice.supported || busy) return;
    if (listening) {
      pauseHandsFree();
      voice.stop();
      return;
    }
    if (voice.status === "error") voice.clearError();
    editedRef.current = false;
    handsFreeArmed.current = handsFree;
    voice.start(value);
  };

  const toggleHandsFree = () => {
    const next = !handsFree;
    onHandsFreeChange(next);
    handsFreeArmed.current = next && voice.supported;
    if (!next) {
      voice.stop();
      return;
    }
    if (voice.supported && (voice.status === "idle" || voice.status === "error")) {
      if (voice.status === "error") voice.clearError();
      editedRef.current = false;
      voice.start(value);
    }
  };

  // Escape stops an open microphone from anywhere in the composer. In
  // hands-free mode it also pauses turn-taking instead of silently resuming.
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        pauseHandsFree();
        voice.stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, onHandsFreeChange, voice.stop]);

  // Put the caret in recognized text so it can be reviewed before sending.
  useEffect(() => {
    if (voice.status !== "recognized") return;
    ref.current?.focus();
    resize();
  }, [voice.status]);

  // Hands-free: a final transcript is sent automatically unless the user edits.
  useEffect(() => {
    if (!handsFree || voice.status !== "recognized" || busy || editedRef.current) return;
    const timer = window.setTimeout(() => {
      if (handsFreeArmed.current && valueRef.current.trim()) submitRef.current();
    }, HANDS_FREE_REVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [handsFree, voice.status, busy, value]);

  // Hands-free turn-taking: start on opt-in, then resume only when HomePilot is
  // neither thinking nor speaking. The microphone is never open during speech,
  // so the assistant cannot transcribe its own answer.
  useEffect(() => {
    if (!handsFree) {
      handsFreeArmed.current = false;
      return;
    }
    // Restored preferences must never open the microphone without a gesture;
    // the explicit toggle (or a mic press) arms this session.
    if (!handsFreeArmed.current) return;
    if (!voice.supported || busy || speaking || voice.status !== "idle") return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (editedRef.current) return;

    const delay = Math.max(350, 1600 - (Date.now() - lastSubmitAt.current));
    const timer = window.setTimeout(() => {
      const current = voiceRef.current;
      if (!handsFreeArmed.current || current.status !== "idle" || current.supported === false) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      current.start(valueRef.current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [handsFree, busy, speaking, voice.status, voice.supported]);

  // A persistent error means hands-free should stop rather than retry blindly.
  useEffect(() => {
    if (handsFree && voice.status === "error") {
      handsFreeArmed.current = false;
      onHandsFreeChange(false);
    }
  }, [handsFree, voice.status, onHandsFreeChange]);

  const providerLabel =
    inputProvider === "google"
      ? "Google transcription · audio sent only when you press the mic"
      : "Browser speech · nothing recorded or stored by HomePilot";

  return (
    <div className="space-y-2">
      <div
        className={`card-raised p-3 transition ${
          listening ? "border-accent/40 ring-2 ring-accent/10" : speaking ? "border-accent/25 ring-1 ring-accent/10" : ""
        }`}
      >
        <div className="flex flex-wrap items-end gap-2.5">
          <span className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
            <Sparkles size={15} aria-hidden="true" />
          </span>

          <textarea
            ref={ref}
            rows={1}
            autoFocus={autoFocus}
            value={value}
            maxLength={2000}
            disabled={listening || processing || busy}
            onChange={(event) => {
              setValue(event.target.value);
              if (voice.status === "recognized") editedRef.current = true;
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(160, event.target.scrollHeight)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              listening
                ? cloudSelected
                  ? "Recording… press stop when you're done"
                  : "Listening… speak now"
                : processing
                  ? "Transcribing your speech…"
                  : busy
                    ? "HomePilot is preparing a plan…"
                    : speaking
                      ? "HomePilot is speaking — the microphone is off"
                      : placeholder
            }
            aria-label="Household request"
            aria-describedby="composer-voice-status"
            className="max-h-40 min-w-[160px] flex-1 resize-none border-0 bg-transparent py-1 text-[14.5px] leading-6 text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />

          <div className="ml-auto flex items-center gap-1.5">
            <label className="sr-only" htmlFor="voice-language">
              Voice language
            </label>
            <select
              id="voice-language"
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as VoiceLanguage)}
              disabled={listening || processing}
              className="field h-9 w-[92px] cursor-pointer py-0 text-[12px] font-medium"
              title={`Voice language: ${activeLanguage.nativeLabel}`}
            >
              {VOICE_LANGUAGES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id === "bn-BD" ? "বাংলা" : "English"}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={toggleHandsFree}
              aria-pressed={handsFree}
              aria-label={handsFree ? "Pause hands-free conversation" : "Start hands-free conversation"}
              title={
                voice.supported
                  ? handsFree
                    ? "Hands-free is on — pauses listening while HomePilot speaks"
                    : "Hands-free: listen, answer, speak, listen again"
                  : (voice.supportMessage ?? "Voice input is unavailable")
              }
              disabled={!voice.supported || busy}
              className={`btn btn-sm h-9 w-9 shrink-0 rounded-full p-0 ${
                handsFree ? "btn-primary" : "btn-secondary"
              }`}
            >
              <Headphones size={15} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={toggleMic}
              disabled={!voice.supported || busy}
              aria-pressed={listening}
              aria-label={
                listening
                  ? "Stop listening"
                  : voice.supported
                    ? "Start voice input"
                    : "Voice input is not supported in this browser"
              }
              title={
                !voice.supported
                  ? (voice.supportMessage ?? "Voice input is not available in this browser.")
                  : listening
                    ? "Stop listening"
                    : "Speak your request"
              }
              className={`btn btn-sm h-9 w-9 shrink-0 rounded-full p-0 ${
                listening ? "btn-primary voice-mic-listening" : "btn-secondary"
              }`}
            >
              {voice.status === "requesting" || processing ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : listening ? (
                <Square size={12} fill="currentColor" aria-hidden="true" />
              ) : (
                <Mic size={15} aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() || busy}
              className="btn btn-primary btn-sm h-9"
              aria-label="Send request"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              <span className="hidden sm:inline">{busy ? "Planning…" : "Plan with AI"}</span>
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-10">
          <div id="composer-voice-status" role="status" aria-live="polite" className="min-w-0">
            {listening ? (
              <span className="chip chip-accent">
                <span className="voice-wave" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                {voice.status === "requesting"
                  ? cloudSelected
                    ? "Opening the microphone…"
                    : "Waiting for microphone…"
                  : cloudSelected
                    ? "Recording — press stop"
                    : "Listening…"}
                {voice.interim ? (
                  <span className="max-w-[220px] truncate font-normal normal-case tracking-normal text-accent-ink">
                    {voice.interim}
                  </span>
                ) : null}
              </span>
            ) : processing ? (
              <span className="chip">
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                {cloudSelected ? "Transcribing with Google…" : "Processing speech…"}
              </span>
            ) : voice.notice ? (
              <span className="chip chip-warning">
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                {voice.notice}
              </span>
            ) : speaking ? (
              <span className="chip chip-accent">
                <span className="voice-wave text-accent" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                Speaking — microphone is off
              </span>
            ) : voice.status === "stopped" ? (
              <span className="chip">
                <Square size={10} fill="currentColor" aria-hidden="true" />
                Stopped listening — nothing was sent
              </span>
            ) : voice.status === "recognized" ? (
              <span className="chip chip-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                {handsFree
                  ? editedRef.current
                    ? "Speech recognized — review, then send"
                    : "Hands-free — sending automatically"
                  : "Speech recognized — review, then send"}
              </span>
            ) : handsFree ? (
              <span className="chip chip-accent">
                <Headphones size={11} aria-hidden="true" />
                Hands-free on — listening resumes after each reply
              </span>
            ) : null}
          </div>

          <p className="text-[11px] leading-4 text-muted">
            {listening ? (
              <button
                type="button"
                className="font-medium text-accent-strong hover:underline"
                onClick={() => {
                  pauseHandsFree();
                  voice.stop();
                }}
              >
                Stop listening (Esc)
              </button>
            ) : !voice.supported ? (
              <span className="flex items-center gap-1.5">
                <Info size={11} aria-hidden="true" />
                Voice input unavailable — typing works everywhere.
              </span>
            ) : (
              `${providerLabel} · ${activeLanguage.label}`
            )}
          </p>
        </div>
      </div>

      {!voice.supported && voice.supportMessage ? (
        <p className="pl-1 text-[12px] leading-5 text-muted">{voice.supportMessage}</p>
      ) : null}

      {voice.status === "error" && voice.error ? (
        <div role="alert">
          <WarningBanner tone="error">
            <p className="font-semibold">{voice.error.title}</p>
            <p>{voice.error.message}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {voice.error.retryable && voice.supported ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    editedRef.current = false;
                    voice.start(value);
                  }}
                  disabled={busy}
                >
                  <Mic size={13} aria-hidden="true" />
                  Try again
                </button>
              ) : null}
              {inputProvider === "browser" && cloudAvailable ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    voice.clearError();
                    onProviderChange("google");
                  }}
                >
                  Use Google transcription
                </button>
              ) : inputProvider === "google" ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    voice.clearError();
                    onProviderChange("browser");
                  }}
                >
                  Use browser speech
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={voice.clearError}>
                Dismiss
              </button>
            </div>
          </WarningBanner>
        </div>
      ) : null}
    </div>
  );
}
