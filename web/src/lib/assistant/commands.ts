import { todayKey } from "../format.js";
import type { ActivityEntry, GroceryItem, Plan, ScheduleEvent, Task } from "../types.js";

/**
 * A deliberately small, conservative command router.
 *
 * The language model is great at turning a goal into a plan, but read-only
 * questions ("what do I need today?") and a few reversible actions ("I already
 * bought milk") should not create a plan at all. Everything ambiguous falls
 * through to the normal propose → review → approve workflow; nothing here can
 * approve a plan or run a destructive action.
 */

export type AssistantIntent =
  | { kind: "today" }
  | { kind: "schedule" }
  | { kind: "groceries" }
  | { kind: "changes" }
  | { kind: "conflicts" }
  | { kind: "cancel_last_plan" }
  | { kind: "mark_purchased"; itemName: string }
  | { kind: "none" };

const CANCEL = /\b(?:cancel|discard|scrap|drop|withdraw)\b.*\b(?:last|that|this|the)\b.*\b(?:plan|change|proposal)\b/i;
const CHANGES = /\b(?:what (?:did|have) you (?:change|changed|do|done|apply|applied)|what changed|show (?:me )?(?:the )?(?:recent )?(?:changes|activity)|action history|audit log)\b/i;
const CONFLICTS = /\b(?:check|any|find|are there)\b.*\b(?:conflicts?|overlaps?|double[- ]booked)\b/i;
const TODAY =
  /^(?:what|show|list|tell me|give me|summari[sz]e)\b.*\b(?:today|my day|daily briefing)\b/i;
const SCHEDULE =
  /^(?:(?:what|show|list|tell me|read)\b.*\b(?:schedule|calendar|events?|appointments?)\b|(?:what(?:'s| is) on )?(?:my )?(?:schedule|calendar)\??$)/i;
const GROCERIES =
  /^(?:(?:what|show|list|tell me|read)\b.*\b(?:buy|get|groceries|grocery|shopping)\b|(?:what(?:'s| is) on )?(?:the |my )?(?:grocery|shopping) list\??$)/i;
const PURCHASED_BOUGHT = /^(?:i (?:just |already )?(?:bought|got|picked up))\s+(.+)$/i;
const PURCHASED_MARK = /^(?:mark|set)\s+(.+?)\s+(?:as\s+)?(?:purchased|bought|done)$/i;

function cleanItemName(raw: string): string {
  return raw
    .replace(/\b(?:today|already|from the store|at the store|this morning|tonight)\b/gi, " ")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyAssistantCommand(text: string): AssistantIntent {
  const input = text.trim();
  if (!input) return { kind: "none" };

  if (CANCEL.test(input)) return { kind: "cancel_last_plan" };
  if (CHANGES.test(input)) return { kind: "changes" };
  if (CONFLICTS.test(input)) return { kind: "conflicts" };

  const bought = PURCHASED_BOUGHT.exec(input) ?? PURCHASED_MARK.exec(input);
  if (bought?.[1]) {
    const itemName = cleanItemName(bought[1]);
    if (itemName.length >= 2 && itemName.length <= 60) return { kind: "mark_purchased", itemName };
  }

  if (GROCERIES.test(input)) return { kind: "groceries" };
  if (SCHEDULE.test(input)) return { kind: "schedule" };
  if (TODAY.test(input)) return { kind: "today" };
  return { kind: "none" };
}

export interface AssistantCommandDeps {
  runTool<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>;
  plans: Plan[];
  cancelPlan(planId: string): Promise<void>;
  refresh(): Promise<void>;
}

export interface AssistantCommandResult {
  text: string;
  speakText: string;
  /** True when a real MCP tool changed data and the UI should refresh. */
  mutated: boolean;
}

function list(names: string[], max = 4): string {
  const shown = names.filter(Boolean).slice(0, max);
  if (shown.length === 0) return "";
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

function formatEvent(event: ScheduleEvent): string {
  const time = event.startTime ? ` at ${event.startTime}` : "";
  return `${event.title} on ${event.date}${time}`;
}

function targetPlan(plans: Plan[]): Plan | undefined {
  return plans.find((plan) => plan.status === "proposed" || plan.status === "approved");
}

async function runCommand(intent: AssistantIntent, deps: AssistantCommandDeps): Promise<AssistantCommandResult | null> {
  switch (intent.kind) {
    case "today": {
      const summary = await deps.runTool<{
        counts?: { openTasks?: number; groceriesToBuy?: number; todayEvents?: number };
        today?: { tasks?: Task[]; events?: ScheduleEvent[] };
      }>("get_household_summary");
      const tasks = summary.today?.tasks ?? [];
      const events = summary.today?.events ?? [];
      const open = summary.counts?.openTasks ?? tasks.length;
      const toBuy = summary.counts?.groceriesToBuy ?? 0;
      const parts = [
        `Today you have ${open} open task${open === 1 ? "" : "s"} and ${events.length} event${events.length === 1 ? "" : "s"}.`,
      ];
      if (tasks.length > 0) parts.push(`Due today: ${list(tasks.map((task) => task.title), 5)}.`);
      if (events.length > 0) parts.push(`On the calendar: ${list(events.map(formatEvent), 3)}.`);
      if (toBuy > 0) parts.push(`${toBuy} grocery item${toBuy === 1 ? "" : "s"} still to buy.`);
      const text = parts.join(" ");
      return { text, speakText: text, mutated: false };
    }

    case "schedule": {
      const data = await deps.runTool<{ events?: ScheduleEvent[] }>("list_schedule", { from: todayKey() });
      const events = (data.events ?? []).slice(0, 5);
      const text =
        events.length === 0
          ? "Your schedule is clear from today onward."
          : `Upcoming: ${list(events.map(formatEvent), 5)}.`;
      return { text, speakText: text, mutated: false };
    }

    case "groceries": {
      const data = await deps.runTool<{ items?: GroceryItem[] }>("list_grocery_items", {
        include_purchased: false,
      });
      const items = data.items ?? [];
      const text =
        items.length === 0
          ? "Nothing is on the grocery list right now."
          : `You still need ${items.length} item${items.length === 1 ? "" : "s"}: ${list(
              items.map((item) => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`),
              8,
            )}.`;
      return { text, speakText: text, mutated: false };
    }

    case "changes": {
      const data = await deps.runTool<{ entries?: ActivityEntry[] }>("get_action_history", { limit: 25 });
      const meaningful = (data.entries ?? []).filter(
        (entry) => entry.kind === "plan" || entry.origin === "plan-executor",
      );
      if (meaningful.length === 0) {
        return { text: "I haven't changed anything in this household yet.", speakText: "I haven't changed anything yet.", mutated: false };
      }
      const text = `Recent changes: ${list(meaningful.map((entry) => entry.summary), 4)}.`;
      return { text, speakText: text, mutated: false };
    }

    case "conflicts": {
      const data = await deps.runTool<{ conflicts?: Array<{ message: string }>; date?: string }>(
        "check_schedule_conflicts",
        { date: todayKey() },
      );
      const conflicts = data.conflicts ?? [];
      const text =
        conflicts.length === 0
          ? "I found no schedule conflicts today."
          : `I found ${conflicts.length} scheduling issue${conflicts.length === 1 ? "" : "s"}: ${list(
              conflicts.map((conflict) => conflict.message),
              3,
            )}.`;
      return { text, speakText: text, mutated: false };
    }

    case "cancel_last_plan": {
      const plan = targetPlan(deps.plans);
      if (!plan) return { text: "There is no open plan to cancel.", speakText: "There is no open plan to cancel.", mutated: false };
      await deps.cancelPlan(plan.id);
      const text = `Cancelled the proposed plan “${plan.title}”. Nothing was changed.`;
      return { text, speakText: text, mutated: true };
    }

    case "mark_purchased": {
      const data = await deps.runTool<{ items?: GroceryItem[] }>("list_grocery_items", {
        include_purchased: true,
      });
      const query = intent.itemName.toLowerCase();
      const matches = (data.items ?? []).filter((item) => item.name.toLowerCase().includes(query));
      if (matches.length === 0) {
        const text = `I couldn't find “${intent.itemName}” on the grocery list.`;
        return { text, speakText: text, mutated: false };
      }
      if (matches.length > 1) {
        const text = `I found more than one match: ${list(matches.map((item) => item.name), 4)}. Which one did you buy?`;
        return { text, speakText: text, mutated: false };
      }
      const item = matches[0]!;
      if (item.purchased) {
        const text = `“${item.name}” is already marked as purchased.`;
        return { text, speakText: text, mutated: false };
      }
      await deps.runTool("mark_grocery_item_purchased", { id: item.id, purchased: true });
      await deps.refresh();
      const text = `Marked “${item.name}” as purchased.`;
      return { text, speakText: text, mutated: true };
    }

    case "none":
      return null;
  }
}

export async function executeAssistantCommand(
  intent: AssistantIntent,
  deps: AssistantCommandDeps,
): Promise<AssistantCommandResult | null> {
  return runCommand(intent, deps);
}
