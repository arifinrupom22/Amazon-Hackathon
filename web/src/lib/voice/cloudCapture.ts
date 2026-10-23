import type { VoiceFailure, VoiceLanguage } from "./types.js";

/**
 * Explicit, opt-in cloud transcription capture.
 *
 * The microphone opens only when the user presses the button while the Google
 * provider is selected. Audio is kept in memory, uploaded once to this app's
 * `/api/transcribe` endpoint, and then discarded — nothing is written to disk,
 * IndexedDB or localStorage. This is deliberately not used for hands-free
 * listening: background audio never leaves the device.
 */

export type TranscribeAudio = (audio: Blob, language: VoiceLanguage) => Promise<string>;

export interface CloudCaptureHandlers {
  onListening: () => void;
  onTranscribing: () => void;
  onFinal: (text: string) => void;
  onFailure: (failure: VoiceFailure) => void;
  onEnd: (info: { hadFinal: boolean; wasAborted: boolean }) => void;
}

interface CloudCaptureOptions {
  language: VoiceLanguage;
  transcribe: TranscribeAudio;
  handlers: CloudCaptureHandlers;
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  Recorder?: typeof MediaRecorder;
  maxDurationMs?: number;
}

const MAX_DURATION_MS = 30_000;

function permissionFailure(error: unknown): VoiceFailure {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      code: "not-allowed",
      title: "Microphone access was denied",
      message:
        "Your browser blocked the microphone. Allow microphone access for this site, then try again. Typing still works.",
      retryable: true,
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "audio-capture",
      title: "No microphone found",
      message: "Connect or enable a microphone, check your system input settings, then try again.",
      retryable: true,
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      code: "audio-capture",
      title: "The microphone is busy",
      message: "Another app may be using the microphone. Close it, then try again.",
      retryable: true,
    };
  }
  return {
    code: "start-failed",
    title: "Voice input couldn't start",
    message: "The microphone is unavailable right now. Check your browser permissions and try again.",
    retryable: true,
  };
}

function transcriptionFailure(error: unknown): VoiceFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "transcription_unavailable" || /503|not configured|GEMINI_API_KEY/i.test(message)) {
    return {
      code: "cloud-unavailable",
      title: "Google transcription isn't configured",
      message:
        "Add GEMINI_API_KEY on the server to use cloud transcription. Browser speech and typing still work.",
      retryable: false,
    };
  }
  if (code === "auth") {
    return {
      code: "cloud-auth",
      title: "Transcription was rejected",
      message: "The server's Google key was rejected. Check the server configuration or type the request.",
      retryable: false,
    };
  }
  if (code === "quota" || code === "rate_limit") {
    return {
      code,
      title: "Transcription is temporarily unavailable",
      message:
        "Google transcription is out of quota or rate limited. Wait a moment, switch to browser speech, or type the request.",
      retryable: true,
    };
  }
  if (code === "no_speech") {
    return {
      code: "no-speech",
      title: "I didn't hear anything",
      message: "No speech was detected in the recording. Try again and speak a little closer.",
      retryable: true,
    };
  }
  if (code === "audio_too_large" || code === "unsupported_audio_type" || code === "empty_audio") {
    return {
      code,
      title: "That recording couldn't be used",
      message: `${message} Keep recordings short (under 30 seconds) or type the request.`,
      retryable: true,
    };
  }
  return {
    code: "cloud-transcription",
    title: "Transcription didn't finish",
    message:
      "The recording couldn't be transcribed. Try again, switch to browser speech, or type the request instead.",
    retryable: true,
  };
}

function pickMimeType(Recorder: typeof MediaRecorder): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const type of candidates) {
    try {
      if (Recorder.isTypeSupported?.(type)) return type;
    } catch {
      /* try the next candidate */
    }
  }
  return "";
}

export class CloudCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private active = false;
  private aborted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mimeType = "";

  constructor(private readonly options: CloudCaptureOptions) {}

  get isActive(): boolean {
    return this.active;
  }

  async start(): Promise<boolean> {
    if (this.active) return false;
    const Recorder = this.options.Recorder ?? (typeof MediaRecorder === "undefined" ? undefined : MediaRecorder);
    const mediaDevices = this.options.mediaDevices ?? navigator.mediaDevices;
    if (!Recorder || !mediaDevices?.getUserMedia) {
      this.options.handlers.onFailure({
        code: "unsupported",
        title: "Google transcription isn't available here",
        message: "This browser cannot record audio. Use browser speech recognition or type the request.",
        retryable: false,
      });
      return false;
    }

    this.active = true;
    this.aborted = false;
    this.chunks = [];

    try {
      this.stream = await mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      this.active = false;
      this.options.handlers.onFailure(permissionFailure(error));
      return false;
    }

    if (this.aborted) {
      this.cleanupStream();
      this.active = false;
      this.options.handlers.onEnd({ hadFinal: false, wasAborted: true });
      return false;
    }

    this.mimeType = pickMimeType(Recorder);
    try {
      this.recorder = this.mimeType ? new Recorder(this.stream, { mimeType: this.mimeType }) : new Recorder(this.stream);
    } catch {
      this.cleanupStream();
      this.active = false;
      this.options.handlers.onFailure({
        code: "start-failed",
        title: "Voice input couldn't start",
        message: "This browser could not start audio recording. Try browser speech or type the request.",
        retryable: false,
      });
      return false;
    }

    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onstop = () => {
      void this.finish();
    };
    this.recorder.onerror = () => {
      this.fail({
        code: "audio-capture",
        title: "The microphone stopped",
        message: "Recording was interrupted. Try again or type the request.",
        retryable: true,
      });
    };

    try {
      this.recorder.start(500);
    } catch {
      this.cleanupStream();
      this.active = false;
      this.options.handlers.onFailure({
        code: "start-failed",
        title: "Voice input couldn't start",
        message: "Recording could not begin. Try again or type the request.",
        retryable: true,
      });
      return false;
    }

    this.options.handlers.onListening();
    this.timer = setTimeout(() => this.stop(), this.options.maxDurationMs ?? MAX_DURATION_MS);
    return true;
  }

  stop(): void {
    if (!this.active) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        this.finish();
      }
      return;
    }
    this.finish();
  }

  abort(): void {
    this.aborted = true;
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    this.recorder = null;
    this.chunks = [];
    this.cleanupStream();
  }

  private async finish(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.cleanupStream();

    const chunks = this.chunks;
    this.chunks = [];
    this.recorder = null;

    if (this.aborted) {
      this.options.handlers.onEnd({ hadFinal: false, wasAborted: true });
      return;
    }
    if (chunks.reduce((total, chunk) => total + chunk.size, 0) === 0) {
      this.options.handlers.onFailure({
        code: "no-speech",
        title: "I didn't hear anything",
        message: "The microphone opened but no audio was captured. Try again and speak a little closer.",
        retryable: true,
      });
      this.options.handlers.onEnd({ hadFinal: false, wasAborted: false });
      return;
    }

    this.options.handlers.onTranscribing();
    try {
      const blob = new Blob(chunks, { type: this.mimeType || "audio/webm" });
      const text = await this.options.transcribe(blob, this.options.language);
      this.options.handlers.onFinal(text);
      this.options.handlers.onEnd({ hadFinal: true, wasAborted: false });
    } catch (error) {
      this.options.handlers.onFailure(transcriptionFailure(error));
      this.options.handlers.onEnd({ hadFinal: false, wasAborted: false });
    }
  }

  private fail(failure: VoiceFailure): void {
    this.options.handlers.onFailure(failure);
    this.abort();
    this.options.handlers.onEnd({ hadFinal: false, wasAborted: false });
  }

  private cleanupStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
