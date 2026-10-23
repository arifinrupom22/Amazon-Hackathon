import { z } from "zod";
import type { ProposalInput, RawPlanAction } from "./types.js";

/** Schema every provider's output must satisfy before it can become a plan. */
export const rawActionSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.unknown()),
  label: z.string().optional(),
  detail: z.string().optional(),
});

export const proposalSchema = z.object({
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().min(10).max(1200),
  assumptions: z.array(z.string().trim().min(3).max(300)).max(20).default([]),
  clarification: z.string().trim().max(400).nullable().default(null),
  actions: z.array(rawActionSchema).min(1).max(40),
});

export type Proposal = z.infer<typeof proposalSchema>;

export const ALLOWED_TOOLS_SPEC = `Allowed tools and arguments (all dates YYYY-MM-DD, all times 24h HH:mm):
- create_task {title, due_date?, due_time?, assignee?, category?, priority?("low"|"medium"|"high"), notes?}
- update_task {id, title?, due_date?, due_time?, assignee?, category?, priority?, notes?, status?}
- complete_task {id}
- create_schedule_event {title, date, start_time?, end_time?, location?, notes?}
- update_schedule_event {id, title?, date?, start_time?, end_time?, location?, notes?}
- add_grocery_item {name, quantity?, unit?, category?, notes?}
- update_grocery_item {id, name?, quantity?, unit?, category?, notes?}
- mark_grocery_item_purchased {id, purchased?}
Never use delete/remove tools. Never invent ids: only use ids found in the CONTEXT block.`;

export function buildSystemPrompt(): string {
  return [
    "You are HomePilot AI, a household coordination assistant.",
    "You convert one natural-language household request into a structured plan of tool actions.",
    "Respond with ONE JSON object only — no prose, no markdown fences, no comments.",
    "Shape:",
    '{"title": string, "summary": string, "assumptions": string[], "clarification": string|null, "actions": [{"tool": string, "args": {}, "label": string, "detail": string}]}',
    ALLOWED_TOOLS_SPEC,
    "Rules:",
    "- Every action must be small, concrete, and verifiable.",
    "- Prefer 2 to 8 actions. Do not create duplicates of items already in CONTEXT.",
    "- Respect household preferences found in CONTEXT (diet, quiet hours, cleaning day).",
    "- If essential information is missing (e.g. no date or time given), still propose your best plan AND set a short, specific 'clarification' question.",
    "- List every assumption you made in 'assumptions'.",
    "- The plan is only a proposal: it is shown to the user for approval before anything is applied.",
  ].join("\n");
}

export function buildUserPrompt(input: ProposalInput): string {
  const household = input.household;
  const context = [
    `TODAY (reference date): ${input.referenceDate}`,
    `HOUSEHOLD: ${household.name} (timezone ${household.timezone})`,
    `MEMBERS: ${household.members.map((m) => `${m.name} — ${m.role}${m.presence ? ` (${m.presence})` : ""}`).join("; ")}`,
    `PREFERENCES: ${Object.entries(household.preferences)
      .map(([key, value]) => `${key}: ${value}`)
      .join(" | ")}`,
    `OPEN TASKS: ${input.tasks
      .filter((task) => task.status === "open")
      .slice(0, 12)
      .map((task) => `${task.title}${task.dueDate ? ` (${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""})` : ""}`)
      .join("; ") || "none"}`,
    `SCHEDULE (next 7 days): ${input.events
      .slice(0, 12)
      .map((event) => `${event.title} on ${event.date}${event.startTime ? ` ${event.startTime}-${event.endTime ?? ""}` : ""}`)
      .join("; ") || "none"}`,
    `GROCERIES TO BUY: ${input.groceries.map((item) => `${item.name} x${item.quantity}${item.unit ? ` ${item.unit}` : ""}`).join("; ") || "none"}`,
    "",
    `REQUEST: ${input.request}`,
  ].join("\n");
  return context;
}

/** Extract the first JSON object from a model response, tolerating code fences. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in the model response.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export function normalizeActions(actions: RawPlanAction[]): RawPlanAction[] {
  return actions
    .filter((action) => action && typeof action.tool === "string")
    .map((action) => ({
      tool: action.tool.trim(),
      args: (action.args ?? {}) as Record<string, unknown>,
      label: typeof action.label === "string" ? action.label : undefined,
      detail: typeof action.detail === "string" ? action.detail : undefined,
    }));
}
