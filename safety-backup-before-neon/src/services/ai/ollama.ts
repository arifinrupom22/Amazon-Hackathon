import { extractJson, normalizeActions, buildSystemPrompt, buildUserPrompt, proposalSchema } from "./prompt.js";
import type { AiProvider, ProposalInput, ProposalOutput, ProviderInfo } from "./types.js";
import { DemoProvider } from "./demo.js";

/**
 * Ollama provider. Gemma 3 4B (or any local model) is requested through
 * `/api/chat` with `format: "json"` so the model is constrained to JSON output.
 * Output is still treated as untrusted: it is parsed, Zod-validated and, on
 * failure, retried once before falling back to the deterministic parser.
 */
export class OllamaProvider implements AiProvider {
  private readonly fallback = new DemoProvider();

  constructor(
    private readonly url: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}

  info(): ProviderInfo {
    return {
      name: "ollama",
      label: `Ollama · ${this.model}`,
      mode: "live",
      model: this.model,
      endpoint: this.url,
    };
  }

  async health(): Promise<{ available: boolean; detail: string }> {
    try {
      const response = await fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) {
        return { available: false, detail: `Ollama responded with HTTP ${response.status}.` };
      }
      const body = (await response.json()) as { models?: { name: string }[] };
      const models = (body.models ?? []).map((m) => m.name);
      const hasModel = models.some((name) => name === this.model || name.startsWith(`${this.model}:`));
      return {
        available: true,
        detail: hasModel
          ? `Ollama reachable with model ${this.model}.`
          : `Ollama reachable, but model "${this.model}" is not installed. Installed: ${models.join(", ") || "none"}. Run: ollama pull ${this.model}`,
      };
    } catch (error) {
      return {
        available: false,
        detail: `Cannot reach Ollama at ${this.url} (${(error as Error).message}). Start it with: ollama serve`,
      };
    }
  }

  async propose(input: ProposalInput): Promise<ProposalOutput> {
    const startedAt = Date.now();
    const messages = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ];

    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const payload: Record<string, unknown> = {
        model: this.model,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
      };
      const response = await fetch(`${this.url}/api/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`Ollama request failed with HTTP ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as { message?: { content?: string } };
      const text = body.message?.content ?? "";
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
      fallbackReason: `Ollama model "${this.model}" returned invalid structured output twice (${lastError}). The deterministic demo parser produced this plan instead.`,
    };
  }
}
