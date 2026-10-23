/**
 * Provider failures are classified so the app can react correctly instead of
 * guessing from a raw HTTP status. Only `quota` triggers the credits-exhausted
 * notification; every failure still degrades to a usable local plan.
 */
export type ProviderErrorKind =
  | "quota"
  | "rate_limit"
  | "auth"
  | "not_found"
  | "network"
  | "invalid_output"
  | "http";

/** Verbatim notification required by the submission spec when credits run out. */
export const QUOTA_EXHAUSTED_NOTICE = "API credits exhausted. Demo mode is now active.";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const QUOTA_HINTS = [
  "resource_exhausted",
  "quota",
  "exceeded your current quota",
  "billing",
  "insufficient",
  "credit",
  "out of tokens",
];

const RATE_LIMIT_HINTS = ["rate limit", "too many requests", "per minute", "perminute", "retry later"];

/**
 * Turn a non-2xx provider response into a classified ProviderError.
 * Google/Gemini returns 429 with `RESOURCE_EXHAUSTED` for both daily quota and
 * short-term rate limits, so the body is inspected to tell them apart.
 */
export function classifyHttpFailure(status: number, body: string, providerLabel: string): ProviderError {
  const text = body.slice(0, 2000);
  const lower = text.toLowerCase();
  const hasQuotaHint = QUOTA_HINTS.some((hint) => lower.includes(hint));
  const hasRateLimitHint = RATE_LIMIT_HINTS.some((hint) => lower.includes(hint));

  if (status === 429 || (status === 403 && hasQuotaHint)) {
    if (hasQuotaHint && !hasRateLimitHint) {
      return new ProviderError(
        `${providerLabel} has no remaining credits for this key.`,
        "quota",
        status,
        text,
      );
    }
    return new ProviderError(`${providerLabel} is rate limiting requests.`, "rate_limit", status, text);
  }
  if (status === 401 || status === 403) {
    return new ProviderError(`${providerLabel} rejected the API key (HTTP ${status}).`, "auth", status, text);
  }
  if (status === 404) {
    return new ProviderError(
      `${providerLabel} does not expose the configured model (HTTP 404).`,
      "not_found",
      status,
      text,
    );
  }
  if (status >= 500) {
    let upstreamMessage = "";
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      upstreamMessage = parsed.error?.message?.trim() ?? "";
    } catch {
      upstreamMessage = "";
    }
    const detail = upstreamMessage ? `: ${upstreamMessage.slice(0, 240)}` : ".";
    return new ProviderError(`${providerLabel} is temporarily unavailable (HTTP ${status})${detail}`, "network", status, text);
  }
  return new ProviderError(`${providerLabel} returned HTTP ${status}.`, "http", status, text);
}

/** A readable, non-alarming reason for the plan card. */
export function describeFailure(error: unknown, providerLabel: string): { kind: ProviderErrorKind; message: string } {
  if (error instanceof ProviderError) {
    if (error.kind === "quota") {
      return { kind: "quota", message: QUOTA_EXHAUSTED_NOTICE };
    }
    if (error.kind === "rate_limit") {
      return { kind: "rate_limit", message: `${providerLabel} is rate limiting requests; the local planner answered for now.` };
    }
    return { kind: error.kind, message: `${providerLabel}: ${error.message}` };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|timed out|aborted|network/i.test(message)) {
    return { kind: "network", message: `Cannot reach ${providerLabel} — ${message}` };
  }
  return { kind: "http", message: `${providerLabel} failed: ${message}` };
}
