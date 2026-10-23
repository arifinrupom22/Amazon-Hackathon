/**
 * Shared domain types for HomePilot AI.
 * Everything here is persisted in PostgreSQL (see src/db/db.ts) and exposed
 * through real MCP tools (see src/mcp/registry.ts).
 */

export type Priority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:mm (24h)
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
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:mm
  endTime: string | null; // HH:mm
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

export interface Household {
  id: string;
  name: string;
  members: HouseholdMember[];
  preferences: HouseholdPreferences;
  timezone: string;
  updatedAt: string;
}

/** One proposed change inside a plan. `tool` is the real MCP tool that will run it. */
export interface PlanAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  detail: string | null;
  domain: "tasks" | "schedule" | "groceries";
  apply: boolean;
  status: "pending" | "applied" | "failed" | "skipped" | "invalid";
  result: PlanActionResult | null;
}

export interface PlanActionResult {
  ok: boolean;
  entityId: string | null;
  message: string;
  raw?: unknown;
}

export type PlanStatus =
  | "proposed"
  | "approved"
  | "applied"
  | "partially_applied"
  | "failed"
  | "cancelled";

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
  status: PlanStatus;
  provider: string;
  providerMode: "demo" | "live";
  createdAt: string;
  updatedAt: string;
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

export interface Conflict {
  kind: "event_overlap" | "duplicate" | "missing_detail";
  severity: "warning" | "error" | "info";
  message: string;
  eventIds: string[];
  actionIds?: string[];
}

export interface TaskCreateInput {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  assignee?: string | null;
  category?: string | null;
  priority?: Priority;
  source?: "user" | "plan";
  planId?: string | null;
}

export interface EventCreateInput {
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  notes?: string | null;
  source?: "user" | "plan";
  planId?: string | null;
}

export interface GroceryCreateInput {
  name: string;
  quantity?: number;
  unit?: string | null;
  category?: string | null;
  notes?: string | null;
  source?: "user" | "plan";
  planId?: string | null;
}
