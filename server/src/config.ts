export type AiProviderName = "demo" | "google" | "ollama" | "openai-compatible";

export interface AppConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  /** PostgreSQL connection string (Neon, local, or container). Server-side only. */
  databaseUrl: string;
  ai: {
    provider: AiProviderName;
    google: { baseUrl: string; model: string; apiKey?: string };
    ollama: { url: string; model: string; apiKey?: string };
    openai: { baseUrl: string; model: string; apiKey?: string };
  };
  /** Optional server-side speech-to-text. Independent of the plan provider. */
  transcription: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    apiKey?: string;
    maxBytes: number;
  };
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1" || value === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawProvider = (env.AI_PROVIDER ?? "demo").trim().toLowerCase();
  // "gemini" and "google-ai-studio" are accepted aliases for the same adapter.
  const provider =
    rawProvider === "gemini" || rawProvider === "google-ai-studio" || rawProvider === "google"
      ? "google"
      : rawProvider;
  if (!["demo", "google", "ollama", "openai-compatible"].includes(provider)) {
    throw new Error(
      `Invalid AI_PROVIDER "${rawProvider}". Expected one of: google, ollama, openai-compatible, demo.`,
    );
  }

  // PORT=0 (ephemeral) is meaningless for a server that prints its own URL,
  // so fall back to the documented default instead of listening on a random port.
  const configuredPort = Number(env.PORT ?? 8787);

  return {
    port: Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 8787,
    host: env.HOST ?? "127.0.0.1",
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseUrl: (env.DATABASE_URL ?? "").trim(),
    ai: {
      provider: provider as AiProviderName,
      google: {
        baseUrl: (env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
        // Gemma 4's 4B-active-parameter variant is the closest hosted match for a
        // "Gemma 4B" model. `gemma-4-31b-it` also works; override with GEMINI_MODEL.
        model: env.GEMINI_MODEL ?? env.GOOGLE_AI_MODEL ?? "gemma-4-26b-a4b-it",
        apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_AI_API_KEY || undefined,
      },
      ollama: {
        url: (env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
        model: env.OLLAMA_MODEL ?? "gemma3:4b",
        apiKey: env.OLLAMA_API_KEY || undefined,
      },
      openai: {
        baseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
        model: env.OPENAI_MODEL ?? "gpt-4o-mini",
        apiKey: env.OPENAI_API_KEY || undefined,
      },
    },
    transcription: {
      enabled: bool(env.GOOGLE_TRANSCRIPTION_ENABLED, true),
      baseUrl: (env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
      model: env.GOOGLE_TRANSCRIPTION_MODEL?.trim() || "gemini-3.5-transcribe",
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_AI_API_KEY || undefined,
      maxBytes: 8 * 1024 * 1024,
    },
  };
}
