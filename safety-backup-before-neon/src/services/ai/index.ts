import type { AppConfig } from "../../config.js";
import { DemoProvider } from "./demo.js";
import { QUOTA_EXHAUSTED_NOTICE, describeFailure, type ProviderErrorKind } from "./errors.js";
import { GoogleAiStudioProvider } from "./google.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import type {
  AiProvider,
  ProposalFallback,
  ProposalInput,
  ProposalOutput,
  ProviderInfo,
} from "./types.js";

/**
 * Resolve the configured provider and wrap it so the app always stays usable:
 * if a live model is unreachable, rate-limited, out of credits, or returns
 * unusable output, the deterministic local planner produces the plan and the
 * response carries a `fallback` notice the UI shows once.
 *
 * The wrapper is also where the controlled quota test is injected. Nothing here
 * ever mutates household data — providers only extract a proposal.
 */
export function createProvider(config: AppConfig): AiProvider {
  const base: AiProvider =
    config.ai.provider === "google"
      ? new GoogleAiStudioProvider(config.ai.google.baseUrl, config.ai.google.model, config.ai.google.apiKey)
      : config.ai.provider === "ollama"
        ? new OllamaProvider(config.ai.ollama.url, config.ai.ollama.model, config.ai.ollama.apiKey)
        : config.ai.provider === "openai-compatible"
          ? new OpenAiCompatibleProvider(
              config.ai.openai.baseUrl,
              config.ai.openai.model,
              config.ai.openai.apiKey,
            )
          : new DemoProvider();

  return new ResilientProvider(base);
}

export class ResilientProvider implements AiProvider {
  private healthCache: { at: number; value: Awaited<ReturnType<AiProvider["health"]>> } | null = null;
  private quotaTestPending = false;
  private readonly demo = new DemoProvider();

  constructor(private readonly base: AiProvider) {}

  info(): ProviderInfo {
    return this.base.info();
  }

  async health(): Promise<{ available: boolean; detail: string }> {
    if (this.base.info().mode === "demo") return this.base.health();
    if (this.healthCache && Date.now() - this.healthCache.at < 15_000) return this.healthCache.value;
    const value = await this.base.health();
    this.healthCache = { at: Date.now(), value };
    return value;
  }

  simulateQuotaExhausted(): void {
    this.quotaTestPending = true;
  }

  async propose(input: ProposalInput): Promise<ProposalOutput> {
    // Controlled test path: behave exactly like a provider that answered 429
    // with RESOURCE_EXHAUSTED, without calling any network endpoint.
    if (this.quotaTestPending) {
      this.quotaTestPending = false;
      const demo = await this.demo.propose(input);
      return {
        ...demo,
        fallbackReason: "Controlled test: simulated quota-exhausted provider response.",
        fallback: {
          notice: QUOTA_EXHAUSTED_NOTICE,
          kind: "quota",
          detail:
            "This was a simulated quota-exhausted response requested from the Resilience test panel. No provider request was made and no credits were consumed.",
          simulated: true,
        },
      };
    }

    const info = this.base.info();
    if (info.mode === "demo") return this.base.propose(input);

    const health = await this.health();
    if (!health.available) {
      const kind: ProviderErrorKind = /key|401|403|permission|credential/i.test(health.detail)
        ? "auth"
        : "network";
      return this.withFallback(input, {
        notice: `${info.label} is unavailable, so the local planner answered this request.`,
        kind,
        detail: health.detail,
        simulated: false,
      });
    }

    try {
      return await this.base.propose(input);
    } catch (error) {
      const failure = describeFailure(error, info.label);
      return this.withFallback(input, {
        notice:
          failure.kind === "quota"
            ? QUOTA_EXHAUSTED_NOTICE
            : `${info.label} could not answer, so the local planner answered this request.`,
        kind: failure.kind,
        detail: failure.message,
        simulated: false,
      });
    }
  }

  private async withFallback(input: ProposalInput, fallback: ProposalFallback): Promise<ProposalOutput> {
    const demo = await this.demo.propose(input);
    // The activity log keeps the technical detail; the UI shows `notice`.
    return { ...demo, fallbackReason: fallback.detail, fallback };
  }
}
