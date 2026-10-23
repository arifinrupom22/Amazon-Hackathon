import type { GroceryItem, Household, ScheduleEvent, Task } from "../../domain/types.js";

/** Raw action as produced by a provider — still untrusted until Zod-validated. */
export interface RawPlanAction {
  tool: string;
  args: Record<string, unknown>;
  label?: string;
  detail?: string;
}

export interface ProposalExtraction {
  title: string;
  summary: string;
  assumptions: string[];
  clarification: string | null;
  actions: RawPlanAction[];
}

export interface ProviderInfo {
  name: "demo" | "google" | "ollama" | "openai-compatible";
  label: string;
  mode: "demo" | "live";
  model: string | null;
  endpoint: string | null;
}

export interface ProposalInput {
  request: string;
  referenceDate: string; // YYYY-MM-DD
  household: Household;
  tasks: Task[];
  events: ScheduleEvent[];
  groceries: GroceryItem[];
}

export interface ProposalFallback {
  /** User-facing notice. Quota exhaustion uses the fixed spec wording. */
  notice: string;
  kind: "quota" | "rate_limit" | "auth" | "not_found" | "network" | "invalid_output" | "http";
  /** Extra debugging context; never shown as the headline. */
  detail: string;
  /** True only when the failure was injected by the controlled test endpoint. */
  simulated: boolean;
}

export interface ProposalOutput {
  extraction: ProposalExtraction;
  /** Set when a configured model failed and the deterministic parser took over. */
  fallbackReason?: string;
  fallback?: ProposalFallback;
  latencyMs: number;
}

export interface AiProvider {
  info(): ProviderInfo;
  health(): Promise<{ available: boolean; detail: string }>;
  propose(input: ProposalInput): Promise<ProposalOutput>;
  /** Controlled test hook: the next request behaves like a quota-exhausted key. */
  simulateQuotaExhausted?(): void;
}
