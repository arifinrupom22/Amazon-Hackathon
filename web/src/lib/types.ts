export type Priority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  dueTime: string | null;
  assignee: string | null;
  category: string | null;
  priority: Priority;
  status: "open" | "completed";
  source: "user" | "plan";
  planId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  notes: string | null;
  source: "user" | "plan";
  planId: string | null;
  createdAt: string;
}

export interface GroceryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  category: string | null;
  notes: string | null;
  purchased: boolean;
  source: "user" | "plan";
  planId: string | null;
  createdAt: string;
  purchasedAt: string | null;
}

export interface PlanAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  detail: string | null;
  domain: "tasks" | "schedule" | "groceries";
  apply: boolean;
  status: "pending" | "applied" | "failed" | "skipped" | "invalid";
  result: { ok: boolean; entityId: string | null; message: string } | null;
}

export interface PlanWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  actionIds: string[];
}

export interface Plan {
  id: string;
  title: string;
  requestText: string;
  summary: string;
  assumptions: string[];
  clarification: string | null;
  warnings: PlanWarning[];
  actions: PlanAction[];
  status: "proposed" | "approved" | "applied" | "partially_applied" | "failed" | "cancelled";
  provider: string;
  providerMode: "demo" | "live";
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionResult {
  plan: Plan;
  status: Plan["status"];
  results: Array<{
    actionId: string;
    tool: string;
    label: string;
    ok: boolean;
    status: PlanAction["status"];
    message: string;
    entityId: string | null;
  }>;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface ActivityEntry {
  id: string;
  ts: string;
  kind: "mcp_tool" | "plan" | "system";
  tool: string | null;
  summary: string;
  detail: unknown;
  status: "ok" | "error";
  origin: "mcp-client" | "server" | "plan-executor";
}

export interface ProviderInfo {
  name: "demo" | "google" | "ollama" | "openai-compatible";
  label: string;
  mode: "demo" | "live";
  model: string | null;
  endpoint: string | null;
}

export interface ProviderFallback {
  /** Headline shown to the user. Quota exhaustion uses the fixed spec wording. */
  notice: string;
  kind: "quota" | "rate_limit" | "auth" | "not_found" | "network" | "invalid_output" | "http";
  detail: string;
  simulated: boolean;
}

export interface ProposeResponse {
  plan: Plan;
  provider: ProviderInfo;
  fallbackReason?: string;
  fallback?: ProviderFallback;
  latencyMs: number;
}

export interface HouseholdMember {
  id: string;
  name: string;
  role: string;
  presence?: string;
}

export interface HouseholdPreferences {
  diet: string;
  quietHours: string;
  cleaningDay: string;
  shoppingDay: string;
  defaultStore: string;
  notes: string;
}

export interface StatusResponse {
  service: { name: string; version: string };
  protocolVersion: string;
  mcpEndpoint: string;
  tools: Array<{ name: string; domain: string; description: string }>;
  provider: ProviderInfo;
  providerHealth: { available: boolean; detail: string };
  transcription?: {
    available: boolean;
    model: string;
    detail: string;
  };
  counts: {
    openTasks: number;
    completedTasks: number;
    todayTasks: number;
    upcomingEvents: number;
    todayEvents: number;
    groceriesToBuy: number;
    groceriesPurchased: number;
  };
  household: {
    id: string;
    name: string;
    members: HouseholdMember[];
    preferences: HouseholdPreferences;
    timezone: string;
  };
}

export interface TraceEntry {
  id: string;
  ts: number;
  method: "initialize" | "tools/list" | "tools/call";
  tool?: string;
  args?: unknown;
  ok: boolean;
  durationMs: number;
  summary: string;
  isError: boolean;
}
