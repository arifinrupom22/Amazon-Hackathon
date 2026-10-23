import { sanitizeForSpeech } from "./synthesis.js";

export interface SpokenPlanInput {
  summary: string;
  actionCount: number;
  clarification?: string | null;
}

/**
 * What the assistant says after proposing a plan. It deliberately does not
 * include provider diagnostics, the quota notification, or internal details:
 * the fallback notice stays visual, and the spoken answer stays useful.
 */
export function spokenPlanText(input: SpokenPlanInput): string {
  const summary = sanitizeForSpeech(input.summary);
  const count = Math.max(0, Math.trunc(input.actionCount));
  const actionLine = `I prepared ${count} action${count === 1 ? "" : "s"} for your review. Nothing has been applied yet.`;
  const question = input.clarification ? `One question: ${sanitizeForSpeech(input.clarification)}` : "";
  return sanitizeForSpeech([summary, actionLine, question].filter(Boolean).join(" "));
}

/** Spoken error copy: calm, actionable and free of stack traces or HTTP codes. */
export const SPOKEN_ERROR_TEXT =
  "I couldn't build that plan. Please try again, or rephrase the request. The details are on screen.";

export function spokenErrorMessage(): string {
  return SPOKEN_ERROR_TEXT;
}

export function spokenClarification(question: string): string {
  return sanitizeForSpeech(`One question before I continue: ${question}`);
}

export interface AutoSpeakInput {
  mounted: boolean;
  autoSpeak: boolean;
  role: "user" | "assistant";
  messageId: string | null;
  lastSpokenId: string | null;
}

/**
 * Auto-speak only new assistant answers: never restored history, never a user
 * message, never the same answer twice, and only when the setting is on.
 */
export function shouldSpeakResponse(input: AutoSpeakInput): boolean {
  if (!input.mounted || !input.autoSpeak) return false;
  if (input.role !== "assistant" || !input.messageId) return false;
  return input.lastSpokenId !== input.messageId;
}
