import { ProviderError, classifyHttpFailure } from "./errors.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  extractJson,
  normalizeActions,
  proposalSchema,
} from "./prompt.js";
import type { AiProvider, ProposalInput, ProposalOutput, ProviderInfo } from "./types.js";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

/**
 * Google AI Studio / Gemini API adapter (`generateContent`).
 *
 * Gemma 4 models on the Gemini API support structured JSON output, so the
 * response is constrained with `responseMimeType: "application/json"`, then
 * Zod-validated. As with every provider this only produces a proposal — the
 * planner validates actions again against the real MCP tool schemas.
 */
export class GoogleAiStudioProvider implements AiProvider {
  private readonly label: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {
    this.label = `Google AI Studio (${model})`;
  }

  info(): ProviderInfo {
    return {
      name: "google",
      label: `Google AI Studio · ${this.model}`,
      mode: "live",
      model: this.model,
      endpoint: this.baseUrl,
    };
  }

  async health(): Promise<{ available: boolean; detail: string }> {
    if (!this.apiKey) {
      return {
        available: false,
        detail: "GEMINI_API_KEY is not set. Add it to .env to enable Google AI Studio.",
      };
    }
    try {
      const response = await fetch(
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}?key=${encodeURIComponent(this.apiKey)}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!response.ok) {
        const failure = classifyHttpFailure(response.status, await response.text(), this.label);
        return { available: false, detail: failure.message };
      }
      return {
        available: true,
        detail: `${this.model} is reachable with the configured Google AI Studio key.`,
      };
    } catch (error) {
      return {
        available: false,
        detail: `Cannot reach generativelanguage.googleapis.com: ${(error as Error).message}`,
      };
    }
  }

  simulateQuotaExhausted(): void {
    // Implemented by the resilient wrapper, which owns the fallback boundary.
  }

  async propose(input: ProposalInput): Promise<ProposalOutput> {
    const startedAt = Date.now();
    if (!this.apiKey) {
      throw new ProviderError(
        "GEMINI_API_KEY is not configured, so Google AI Studio cannot be called.",
        "auth",
      );
    }

    const contents: GeminiContent[] = [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }];
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = await this.generate(contents);
      try {
        const parsed = proposalSchema.parse(extractJson(text));
        return {
          extraction: {
            title: parsed.title,
            summary: parsed.summary,
            assumptions: parsed.assumptions,
            clarification: parsed.clarification,
            actions: normalizeActions(parsed.actions),
          },
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = (error as Error).message;
        contents.push({ role: "model", parts: [{ text: text || "(empty response)" }] });
        contents.push({
          role: "user",
          parts: [
            {
              text: `That response was invalid: ${lastError}. Reply with corrected JSON only, using exactly the required shape and allowed tools.`,
            },
          ],
        });
      }
    }

    throw new ProviderError(
      `${this.label} returned invalid structured output twice (${lastError}).`,
      "invalid_output",
    );
  }

  private async generate(contents: GeminiContent[]): Promise<string> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(
      this.apiKey!,
    )}`;

    const base = {
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents,
    };
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    };
    // Gemma 4 can spend most of a small response budget on internal thinking.
    // Keep its reasoning minimal so it has room to return the requested plan.
    if (/^gemma-4-/i.test(this.model)) {
      generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
    }

    const withConfig = {
      ...base,
      generationConfig,
    };

    const send = (payload: typeof withConfig | typeof base) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    let response = await send(withConfig);

    // Older/edge endpoints may reject generationConfig; retry once without it
    // instead of failing a request that the model could answer.
    if (response.status === 400) {
      const bodyText = await response.text();
      if (/generationConfig|responseMimeType|Unknown name|Invalid JSON payload/i.test(bodyText)) {
        response = await send(base);
      } else {
        throw classifyHttpFailure(400, bodyText, this.label);
      }
    }

    if (response.status === 500 || response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      response = await send(withConfig);
    }

    if (!response.ok) {
      throw classifyHttpFailure(response.status, await response.text(), this.label);
    }

    const payload = (await response.json()) as GeminiResponse;
    if (payload.promptFeedback?.blockReason) {
      throw new ProviderError(
        `${this.label} blocked the request (${payload.promptFeedback.blockReason}).`,
        "invalid_output",
      );
    }
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new ProviderError(
        `${this.label} used its response budget before returning a plan.`,
        "invalid_output",
      );
    }
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new ProviderError(`${this.label} returned an empty response.`, "invalid_output");
    }
    return text;
  }
}
