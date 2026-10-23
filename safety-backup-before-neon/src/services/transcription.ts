import { ProviderError, classifyHttpFailure } from "./ai/errors.js";

/**
 * Optional server-side speech-to-text through Google AI Studio.
 *
 * This exists because browser speech recognition can fail with `network` even
 * when the user's connection is fine: Chrome sends audio to a Google speech
 * service whose availability is outside this app's control. When a key is
 * configured, the browser can explicitly hand a short recording to this server
 * instead.
 *
 * Privacy: audio is sent only after an explicit user action, is never written to
 * disk or the database, and the temporary Google file is deleted after the
 * transcript is returned (best effort). Only the transcript text is kept.
 */

export type TranscriptionLanguage = "en-US" | "bn-BD" | "auto";

export interface TranscriptionInfo {
  available: boolean;
  model: string;
  detail: string;
}

export interface TranscriptionInput {
  audio: Buffer;
  mimeType: string;
  language: TranscriptionLanguage;
}

export interface TranscriptionResult {
  text: string;
  model: string;
  language: TranscriptionLanguage;
  latencyMs: number;
}

export type TranscriptionErrorCode =
  | "unavailable"
  | "invalid_audio"
  | "no_speech"
  | "auth"
  | "quota"
  | "rate_limit"
  | "network"
  | "upstream";

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly code: TranscriptionErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export const SUPPORTED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
  "audio/opus",
] as const;

export function normalizeAudioType(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (SUPPORTED_AUDIO_TYPES as readonly string[]).includes(base) ? base : null;
}

interface GoogleFile {
  name?: string;
  uri?: string;
}

interface GoogleTranscriptionResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

interface ServiceOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxBytes: number;
  enabled?: boolean;
  fetchImpl?: typeof fetch;
}

const UPLOAD_TIMEOUT_MS = 30_000;
const TRANSCRIBE_TIMEOUT_MS = 45_000;

/** The Files API lives above `/v1beta`; keep custom base URLs working too. */
function uploadEndpoint(baseUrl: string): string {
  const root = baseUrl.replace(/\/v1beta$/, "");
  return `${root}/upload/v1beta/files`;
}

export class GoogleTranscriptionService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  info(): TranscriptionInfo {
    if (this.options.enabled === false) {
      return {
        available: false,
        model: this.options.model,
        detail: "Server transcription is disabled by GOOGLE_TRANSCRIPTION_ENABLED=false.",
      };
    }
    if (!this.options.apiKey) {
      return {
        available: false,
        model: this.options.model,
        detail: "Add GEMINI_API_KEY to .env to enable Google AI transcription.",
      };
    }
    return {
      available: true,
      model: this.options.model,
      detail: `Short recordings can be transcribed by ${this.options.model}. Audio is sent to Google only when you choose it.`,
    };
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const info = this.info();
    if (!info.available) throw new TranscriptionError(info.detail, "unavailable");

    if (!Buffer.isBuffer(input.audio) || input.audio.length === 0) {
      throw new TranscriptionError("The recording was empty. Try again and speak after the microphone opens.", "invalid_audio");
    }
    if (input.audio.length > this.options.maxBytes) {
      throw new TranscriptionError("The recording is too large. Keep it under 30 seconds.", "invalid_audio");
    }
    const mimeType = normalizeAudioType(input.mimeType);
    if (!mimeType) {
      throw new TranscriptionError(
        "That audio format is not supported. Use a browser recording (WebM, Ogg, MP4) or type the request.",
        "invalid_audio",
      );
    }

    const file = await this.upload(input.audio, mimeType);
    try {
      const text = await this.generate(file.uri, mimeType, input.language);
      return {
        text,
        model: this.options.model,
        language: input.language,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      // Best effort: do not leave the user's audio in Google's temporary store.
      if (file.name) void this.deleteFile(file.name);
    }
  }

  private async upload(audio: Buffer, mimeType: string): Promise<Required<Pick<GoogleFile, "uri">> & GoogleFile> {
    const key = encodeURIComponent(this.options.apiKey!);
    let start: Response;
    try {
      start = await this.fetchImpl(`${uploadEndpoint(this.options.baseUrl)}?key=${key}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-upload-protocol": "resumable",
          "x-goog-upload-command": "start",
          "x-goog-upload-header-content-length": String(audio.length),
          "x-goog-upload-header-content-type": mimeType,
        },
        body: JSON.stringify({ file: { display_name: `homepilot-${Date.now()}` } }),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TranscriptionError(
        `Could not reach Google transcription: ${(error as Error).message}`,
        "network",
      );
    }

    if (!start.ok) throw this.fromHttp(start.status, await start.text());

    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      throw new TranscriptionError("Google did not return an upload URL. Try again or type the request.", "upstream");
    }

    let finalized: Response;
    try {
      finalized = await this.fetchImpl(uploadUrl, {
        method: "POST",
        headers: {
          "x-goog-upload-command": "upload, finalize",
          "x-goog-upload-offset": "0",
          "x-goog-upload-header-content-type": mimeType,
        },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TranscriptionError(
        `The audio upload did not finish: ${(error as Error).message}`,
        "network",
      );
    }
    if (!finalized.ok) throw this.fromHttp(finalized.status, await finalized.text());

    const payload = (await finalized.json().catch(() => ({}))) as { file?: GoogleFile };
    if (!payload.file?.uri) {
      throw new TranscriptionError("Google did not return a usable audio file. Try again.", "upstream");
    }
    return payload.file as Required<Pick<GoogleFile, "uri">> & GoogleFile;
  }

  private async generate(uri: string, mimeType: string, language: TranscriptionLanguage): Promise<string> {
    const url = `${this.options.baseUrl}/models/${encodeURIComponent(this.options.model)}:generateContent?key=${encodeURIComponent(
      this.options.apiKey!,
    )}`;
    const generationConfig =
      language === "auto" ? { audioTranscriptionConfig: {} } : { audioTranscriptionConfig: { languageCodes: [language] } };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ fileData: { fileUri: uri, mimeType } }] }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TranscriptionError(
        `Google transcription did not respond: ${(error as Error).message}`,
        "network",
      );
    }

    if (!response.ok) throw this.fromHttp(response.status, await response.text());

    const payload = (await response.json().catch(() => ({}))) as GoogleTranscriptionResponse;
    if (payload.promptFeedback?.blockReason) {
      throw new TranscriptionError("That recording could not be transcribed. Try again or type the request.", "invalid_audio");
    }
    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      throw new TranscriptionError("No speech was detected in that recording. Try again and speak a little closer.", "no_speech");
    }
    return text;
  }

  private async deleteFile(name: string): Promise<void> {
    try {
      await this.fetchImpl(
        `${this.options.baseUrl}/${name.replace(/^\/+/, "")}?key=${encodeURIComponent(this.options.apiKey!)}`,
        { method: "DELETE", signal: AbortSignal.timeout(8000) },
      );
    } catch {
      // Cleanup failure must never fail the transcript.
    }
  }

  private fromHttp(status: number, body: string): TranscriptionError {
    const failure: ProviderError = classifyHttpFailure(status, body, "Google transcription");
    const code: TranscriptionErrorCode =
      failure.kind === "quota"
        ? "quota"
        : failure.kind === "rate_limit"
          ? "rate_limit"
          : failure.kind === "auth"
            ? "auth"
            : failure.kind === "network"
              ? "network"
              : "upstream";
    return new TranscriptionError(failure.message, code, status);
  }
}
