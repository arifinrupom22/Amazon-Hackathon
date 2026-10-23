import { extractJson, normalizeActions, buildSystemPrompt, buildUserPrompt, proposalSchema } from "./prompt.js";
import type { AiProvider, ProposalInput, ProposalOutput, ProviderInfo } from "./types.js";
import { DemoProvider } from "./demo.js";

/**
 * Any OpenAI-compatible `/chat/completions` endpoint (OpenAI, Together, Groq,
 * LM Studio, vLLM, …). Output is JSON-constrained when the endpoint supports
 * `response_format`, then parsed and Zod-validated like every other provider.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  private readonly fallback = new DemoProvider();

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}

  info(): ProviderInfo {
    return {
      name: "openai-compatible",
      label: `OpenAI-compatible · ${this.model}`,
      mode: "live",
      model: this.model,
      endpoint: this.baseUrl,
    };
  }

  async health(): Promise<{ available: boolean; detail: string }> {
    if (!this.apiKey) {
      return {
        available: false,
        detail: "OPENAI_API_KEY is not set. Add it to .env to enable this provider.",
      };
    }
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { available: false, detail: `${this.baseUrl} responded with HTTP ${response.status}.` };
      }
      return { available: true, detail: `${this.baseUrl} reachable with the configured key.` };
    } catch (error) {
      return {
        available: false,
        detail: `Cannot reach ${this.baseUrl}: ${(error as Error).message}`,
      };
    }
  }

  async propose(input: ProposalInput): Promise<ProposalOutput> {
    const startedAt = Date.now();
    if (!this.apiKey) {
      const demo = await this.fallback.propose(input);
      return {
        ...demo,
        latencyMs: Date.now() - startedAt,
        fallbackReason: "OPENAI_API_KEY is not configured, so the deterministic demo parser produced this plan.",
      };
    }

    const messages = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ];
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`${this.baseUrl} returned HTTP ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content ?? "";
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
        messages.push({ role: "assistant", content: text || "(empty)" });
        messages.push({
          role: "user",
          content: `That response was invalid: ${lastError}. Reply with corrected JSON only, using exactly the required shape and allowed tools.`,
        });
      }
    }

    const demo = await this.fallback.propose(input);
    return {
      ...demo,
      latencyMs: Date.now() - startedAt,
      fallbackReason: `The model returned invalid structured output twice (${lastError}). The deterministic demo parser produced this plan instead.`,
    };
  }
}
