import { z } from "zod";
import { findScheduleConflicts } from "../domain/conflicts.js";
import { toDateKey } from "../domain/dates.js";
import type {
  Conflict,
  EventCreateInput,
  GroceryCreateInput,
  TaskCreateInput,
} from "../domain/types.js";
import type { Planner } from "../services/planner.js";
import type { Store } from "../services/store.js";
import { NotFoundError } from "../services/store.js";

/**
 * Every MCP tool HomePilot exposes lives in this registry.
 *
 * The same definitions are used twice:
 *   1. `src/mcp/server.ts` registers them on the real MCP server
 *      (name + description + Zod raw shape -> JSON Schema) so a web MCP client
 *      can discover them with `tools/list` and run them with `tools/call`.
 *   2. `src/services/planner.ts` validates and executes approved plan actions
 *      through `run()` — the exact same code path, so a plan can never bypass
 *      the schema validation that protects the MCP endpoint.
 */

export interface ToolContext {
  store: Store;
  getPlanner(): Planner;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolDomain = "household" | "tasks" | "schedule" | "groceries" | "planning";

export interface AnyToolDef {
  name: string;
  description: string;
  domain: ToolDomain;
  inputSchema: z.ZodRawShape;
  schema: z.ZodObject<z.ZodRawShape>;
  run(args: unknown, ctx: ToolContext): Promise<unknown>;
}

interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  description: string;
  domain: ToolDomain;
  inputSchema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<unknown>;
}

function defineTool<Shape extends z.ZodRawShape>(def: ToolDefinition<Shape>): AnyToolDef {
  const schema = z.object(def.inputSchema);
  return {
    name: def.name,
    description: def.description,
    domain: def.domain,
    inputSchema: def.inputSchema,
    schema,
    async run(rawArgs, ctx) {
      const parsed = schema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new ToolError(`Invalid arguments for ${def.name}: ${issues}`);
      }
      return def.handler(parsed.data as z.infer<z.ZodObject<Shape>>, ctx);
    },
  };
}

/* ------------------------------ shared fields ----------------------------- */

const DATE = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a valid calendar date.");

const TIME = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time in 24h HH:mm format.");

const PRIORITY = z.enum(["low", "medium", "high"]);
const CONFIRM = z
  .boolean()
  .optional()
  .default(false)
  .describe("Destructive tools require an explicit `true` confirmation from the user.");

/* -------------------------------- household ------------------------------- */

const getHouseholdSummary = defineTool({
  name: "get_household_summary",
  description:
    "Return a compact snapshot of the household: members, open/completed task counts, today's tasks, upcoming events and the grocery list state. Good first tool to call.",
  domain: "household",
  inputSchema: {},
  handler: async (_args, ctx) => {
    const household = await ctx.store.getHousehold();
    const today = toDateKey();
    return {
      household: { id: household.id, name: household.name, timezone: household.timezone },
      members: household.members,
      counts: await ctx.store.summary(),
      today: {
        date: today,
        tasks: await ctx.store.listTasks({ status: "open", dueDate: today }),
        events: await ctx.store.listEvents({ date: today }),
      },
      upcomingEvents: (await ctx.store.listEvents({ from: today })).slice(0, 5),
    };
  },
});

const getHouseholdPreferences = defineTool({
  name: "get_household_preferences",
  description:
    "Return household members and their persisted preferences (diet, quiet hours, cleaning day, shopping day, store, notes). Use these to personalise plans.",
  domain: "household",
  inputSchema: {},
  handler: async (_args, ctx) => {
    const household = await ctx.store.getHousehold();
    return {
      household: household.name,
      timezone: household.timezone,
      members: household.members,
      preferences: household.preferences,
      updatedAt: household.updatedAt,
    };
  },
});

const getActionHistory = defineTool({
  name: "get_action_history",
  description:
    "Return recent household activity: proposed/applied plans and the MCP tool calls that changed data. Read-only; use it to answer questions like 'what did you change?' or to audit a plan.",
  domain: "household",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().default(20).describe("How many entries to return."),
  },
  handler: async (args, ctx) => {
    const entries = await ctx.store.listActivity(args.limit);
    return {
      count: entries.length,
      entries: entries.map((entry) => ({
        id: entry.id,
        ts: entry.ts,
        kind: entry.kind,
        tool: entry.tool,
        summary: entry.summary,
        status: entry.status,
        origin: entry.origin,
      })),
    };
  },
});

/* ---------------------------------- tasks --------------------------------- */

const listTasks = defineTool({
  name: "list_tasks",
  description:
    "List household tasks. Optionally filter by status (open/completed), due date (YYYY-MM-DD) or assignee.",
  domain: "tasks",
  inputSchema: {
    status: z.enum(["open", "completed"]).optional().describe("Filter by task status."),
    due_date: DATE.optional().describe("Only tasks due on this date."),
    assignee: z.string().trim().min(1).optional().describe("Only tasks assigned to this person."),
  },
  handler: async (args, ctx) => {
    const tasks = await ctx.store.listTasks({
      status: args.status,
      dueDate: args.due_date,
      assignee: args.assignee,
    });
    return { count: tasks.length, tasks };
  },
});

const createTask = defineTool({
  name: "create_task",
  description:
    "Create a household task. Duplicate open tasks with the same title and due date are refused unless allow_duplicate is true.",
  domain: "tasks",
  inputSchema: {
    title: z.string().trim().min(2, "A task title needs at least 2 characters.").max(200),
    due_date: DATE.optional().describe("Due date (YYYY-MM-DD)."),
    due_time: TIME.optional().describe("Due time (HH:mm, 24h)."),
    assignee: z.string().trim().min(1).max(80).optional(),
    category: z.string().trim().min(1).max(40).optional().describe("e.g. Cleaning, Kitchen, Family"),
    priority: PRIORITY.optional().default("medium"),
    notes: z.string().trim().max(1000).optional(),
    allow_duplicate: z.boolean().optional().default(false),
    plan_id: z.string().trim().max(60).optional().describe("Provenance: the approved plan that created this record."),
  },
  handler: async (args, ctx) => {
    const duplicate = await ctx.store.findOpenDuplicateTask(args.title, args.due_date ?? null);
    if (duplicate && !args.allow_duplicate) {
      return {
        created: false,
        duplicate: true,
        task: duplicate,
        message: `An open task titled "${duplicate.title}" already exists on ${duplicate.dueDate ?? "no date"}. Nothing was created.`,
      };
    }
    const input: TaskCreateInput = {
      title: args.title,
      dueDate: args.due_date ?? null,
      dueTime: args.due_time ?? null,
      assignee: args.assignee ?? null,
      category: args.category ?? null,
      priority: args.priority,
      notes: args.notes ?? null,
      source: args.plan_id ? "plan" : "user",
      planId: args.plan_id ?? null,
    };
    const task = await ctx.store.createTask(input);
    return { created: true, task, message: `Created task "${task.title}".` };
  },
});

const updateTask = defineTool({
  name: "update_task",
  description: "Update fields of an existing task (title, due date/time, assignee, category, priority, notes, status).",
  domain: "tasks",
  inputSchema: {
    id: z.string().trim().min(1),
    title: z.string().trim().min(2).max(200).optional(),
    due_date: DATE.nullable().optional(),
    due_time: TIME.nullable().optional(),
    assignee: z.string().trim().min(1).max(80).nullable().optional(),
    category: z.string().trim().min(1).max(40).nullable().optional(),
    priority: PRIORITY.optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["open", "completed"]).optional(),
  },
  handler: async (args, ctx) => {
    const { id, ...patch } = args;
    const task = await ctx.store.updateTask(id, patch);
    return { updated: true, task, message: `Updated task "${task.title}".` };
  },
});

const completeTask = defineTool({
  name: "complete_task",
  description: "Mark a task as completed. Completing an already-completed task is a no-op, not an error.",
  domain: "tasks",
  inputSchema: { id: z.string().trim().min(1) },
  handler: async (args, ctx) => {
    const existing = await ctx.store.getTask(args.id);
    if (existing.status === "completed") {
      return { completed: false, alreadyCompleted: true, task: existing, message: "Task was already completed." };
    }
    const task = await ctx.store.completeTask(args.id);
    return { completed: true, task, message: `Completed "${task.title}".` };
  },
});

const deleteTask = defineTool({
  name: "delete_task",
  description: "Delete a task permanently. Requires confirm=true — destructive operations are never implicit.",
  domain: "tasks",
  inputSchema: { id: z.string().trim().min(1), confirm: CONFIRM },
  handler: async (args, ctx) => {
    if (!args.confirm) {
      throw new ToolError("Deleting a task requires confirm=true.");
    }
    const result = await ctx.store.deleteTask(args.id);
    return { ...result, message: `Deleted task "${result.title}".` };
  },
});

/* -------------------------------- schedule -------------------------------- */

const listSchedule = defineTool({
  name: "list_schedule",
  description:
    "List schedule events. Filter by a single date, or by an inclusive from/to date range. Defaults to everything from today onwards.",
  domain: "schedule",
  inputSchema: {
    date: DATE.optional(),
    from: DATE.optional(),
    to: DATE.optional(),
  },
  handler: async (args, ctx) => {
    const today = toDateKey();
    const events = await ctx.store.listEvents({
      date: args.date,
      from: args.date ? undefined : (args.from ?? today),
      to: args.to,
    });
    return { count: events.length, events };
  },
});

const createScheduleEvent = defineTool({
  name: "create_schedule_event",
  description: "Create a schedule event (a timed block on a day). Warns about overlaps but still creates the event.",
  domain: "schedule",
  inputSchema: {
    title: z.string().trim().min(2).max(200),
    date: DATE,
    start_time: TIME.optional(),
    end_time: TIME.optional(),
    location: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    plan_id: z.string().trim().max(60).optional().describe("Provenance: the approved plan that created this event."),
  },
  handler: async (args, ctx) => {
    if (args.start_time && args.end_time && args.end_time <= args.start_time) {
      throw new ToolError(`End time (${args.end_time}) must be after start time (${args.start_time}).`);
    }
    const input: EventCreateInput = {
      title: args.title,
      date: args.date,
      startTime: args.start_time ?? null,
      endTime: args.end_time ?? null,
      location: args.location ?? null,
      notes: args.notes ?? null,
      source: args.plan_id ? "plan" : "user",
      planId: args.plan_id ?? null,
    };
    const event = await ctx.store.createEvent(input);
    const conflicts = findScheduleConflicts(await ctx.store.listEvents({ date: args.date }), [
      { title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime },
    ]).filter((conflict) => conflict.eventIds.includes(event.id));
    return {
      created: true,
      event,
      conflicts,
      message: `Created "${event.title}" on ${event.date}${event.startTime ? ` at ${event.startTime}` : ""}.`,
    };
  },
});

const updateScheduleEvent = defineTool({
  name: "update_schedule_event",
  description: "Update fields of an existing schedule event (title, date, times, location, notes).",
  domain: "schedule",
  inputSchema: {
    id: z.string().trim().min(1),
    title: z.string().trim().min(2).max(200).optional(),
    date: DATE.optional(),
    start_time: TIME.nullable().optional(),
    end_time: TIME.nullable().optional(),
    location: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  },
  handler: async (args, ctx) => {
    const { id, ...patch } = args;
    const existing = await ctx.store.getEvent(id);
    const start = patch.start_time !== undefined ? patch.start_time : existing.startTime;
    const end = patch.end_time !== undefined ? patch.end_time : existing.endTime;
    if (start && end && end <= start) {
      throw new ToolError(`End time (${end}) must be after start time (${start}).`);
    }
    const event = await ctx.store.updateEvent(id, patch);
    return { updated: true, event, message: `Updated "${event.title}".` };
  },
});

const deleteScheduleEvent = defineTool({
  name: "delete_schedule_event",
  description: "Delete a schedule event permanently. Requires confirm=true.",
  domain: "schedule",
  inputSchema: { id: z.string().trim().min(1), confirm: CONFIRM },
  handler: async (args, ctx) => {
    if (!args.confirm) {
      throw new ToolError("Deleting a schedule event requires confirm=true.");
    }
    const result = await ctx.store.deleteEvent(args.id);
    return { ...result, message: `Deleted event "${result.title}".` };
  },
});

const checkScheduleConflicts = defineTool({
  name: "check_schedule_conflicts",
  description:
    "Check a candidate event (or the whole day) for time overlaps with the stored schedule. Use before creating events.",
  domain: "schedule",
  inputSchema: {
    date: DATE,
    title: z.string().trim().min(2).max(200).optional().describe("Candidate event title."),
    start_time: TIME.optional(),
    end_time: TIME.optional(),
  },
  handler: async (args, ctx) => {
    const existing = await ctx.store.listEvents({ date: args.date });
    const candidates = args.title
      ? [
          {
            title: args.title,
            date: args.date,
            startTime: args.start_time ?? null,
            endTime: args.end_time ?? null,
          },
        ]
      : existing.map((event) => ({
          title: event.title,
          date: event.date,
          startTime: event.startTime,
          endTime: event.endTime,
        }));
    const conflicts: Conflict[] = findScheduleConflicts(existing, candidates);
    return {
      date: args.date,
      existingEvents: existing.length,
      conflicts,
      hasConflicts: conflicts.some((conflict) => conflict.severity !== "info"),
    };
  },
});

/* -------------------------------- groceries ------------------------------- */

const listGroceryItems = defineTool({
  name: "list_grocery_items",
  description: "List grocery items. By default only unpurchased items are returned.",
  domain: "groceries",
  inputSchema: {
    include_purchased: z.boolean().optional().default(false),
  },
  handler: async (args, ctx) => {
    const items = await ctx.store.listGroceries({ includePurchased: args.include_purchased });
    return { count: items.length, items };
  },
});

const addGroceryItem = defineTool({
  name: "add_grocery_item",
  description:
    "Add an item to the grocery list. An existing unpurchased item with the same name is updated instead of duplicated unless allow_duplicate is true.",
  domain: "groceries",
  inputSchema: {
    name: z.string().trim().min(1).max(120),
    quantity: z.number().positive().max(999).optional().default(1),
    unit: z.string().trim().max(40).nullable().optional().describe("e.g. kg, cartons, cans"),
    category: z.string().trim().max(40).nullable().optional().describe("e.g. Produce, Pantry"),
    notes: z.string().trim().max(500).nullable().optional(),
    allow_duplicate: z.boolean().optional().default(false),
    plan_id: z.string().trim().max(60).optional().describe("Provenance: the approved plan that created this item."),
  },
  handler: async (args, ctx) => {
    const duplicate = await ctx.store.findDuplicateGrocery(args.name);
    if (duplicate && !args.allow_duplicate) {
      const merged = await ctx.store.updateGrocery(duplicate.id, {
        quantity: duplicate.quantity + args.quantity,
        unit: args.unit ?? duplicate.unit,
        category: args.category ?? duplicate.category,
      });
      return {
        created: false,
        merged: true,
        item: merged,
        message: `"${merged.name}" was already on the list — quantity raised to ${merged.quantity}.`,
      };
    }
    const input: GroceryCreateInput = {
      name: args.name,
      quantity: args.quantity,
      unit: args.unit ?? null,
      category: args.category ?? null,
      notes: args.notes ?? null,
      source: args.plan_id ? "plan" : "user",
      planId: args.plan_id ?? null,
    };
    const item = await ctx.store.addGrocery(input);
    return { created: true, item, message: `Added ${item.quantity} ${item.unit ?? ""} ${item.name}.`.trim() };
  },
});

const updateGroceryItem = defineTool({
  name: "update_grocery_item",
  description: "Update a grocery item (name, quantity, unit, category, notes).",
  domain: "groceries",
  inputSchema: {
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().positive().max(999).optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    category: z.string().trim().max(40).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  },
  handler: async (args, ctx) => {
    const { id, ...patch } = args;
    const item = await ctx.store.updateGrocery(id, patch);
    return { updated: true, item, message: `Updated "${item.name}".` };
  },
});

const removeGroceryItem = defineTool({
  name: "remove_grocery_item",
  description: "Remove an item from the grocery list permanently. Requires confirm=true.",
  domain: "groceries",
  inputSchema: { id: z.string().trim().min(1), confirm: CONFIRM },
  handler: async (args, ctx) => {
    if (!args.confirm) {
      throw new ToolError("Removing a grocery item requires confirm=true.");
    }
    const result = await ctx.store.removeGrocery(args.id);
    return { ...result, message: `Removed "${result.name}" from the grocery list.` };
  },
});

const markGroceryItemPurchased = defineTool({
  name: "mark_grocery_item_purchased",
  description: "Mark a grocery item as purchased (or un-purchase it with purchased=false).",
  domain: "groceries",
  inputSchema: {
    id: z.string().trim().min(1),
    purchased: z.boolean().optional().default(true),
  },
  handler: async (args, ctx) => {
    const item = await ctx.store.setGroceryPurchased(args.id, args.purchased);
    return {
      updated: true,
      item,
      message: args.purchased
        ? `Marked "${item.name}" as purchased.`
        : `Moved "${item.name}" back to the shopping list.`,
    };
  },
});

/* -------------------------------- planning -------------------------------- */

const generateHouseholdPlan = defineTool({
  name: "generate_household_plan",
  description:
    "Turn a natural-language household request into a structured, reviewable plan of MCP tool actions. The plan is stored with status `proposed` and is NOT applied until the user approves it. Returns the plan id, assumptions, warnings and a clarification question when information is missing.",
  domain: "planning",
  inputSchema: {
    request: z.string().trim().min(5).max(2000).describe("The household request, in plain language."),
    reference_date: DATE.optional().describe("Defaults to today (server local time)."),
  },
  handler: async (args, ctx) => {
    const proposal = await ctx.getPlanner().propose({
      request: args.request,
      referenceDate: args.reference_date ?? toDateKey(),
    });
    return {
      plan: proposal.plan,
      provider: proposal.provider,
      warnings: proposal.plan.warnings,
      assumptions: proposal.plan.assumptions,
      clarification: proposal.plan.clarification,
      message: `Plan "${proposal.plan.title}" generated with ${proposal.plan.actions.length} proposed action(s). Review and approve to apply.`,
    };
  },
});

const validateHouseholdPlan = defineTool({
  name: "validate_household_plan",
  description:
    "Re-validate a stored plan: every action is re-checked against its tool schema, and schedule conflicts are recomputed. Nothing is applied.",
  domain: "planning",
  inputSchema: { plan_id: z.string().trim().min(1) },
  handler: async (args, ctx) => {
    const plan = await ctx.store.getPlan(args.plan_id);
    if (!plan) throw new NotFoundError("Plan", args.plan_id);
    const validation = await ctx.getPlanner().validate(plan.id);
    return validation;
  },
});

const applyApprovedPlan = defineTool({
  name: "apply_approved_plan",
  description:
    "Execute an approved plan: runs each enabled action through its MCP tool. The stored plan is re-validated on the server first — client payloads are never trusted. Requires confirm=true.",
  domain: "planning",
  inputSchema: {
    plan_id: z.string().trim().min(1),
    confirm: CONFIRM,
  },
  handler: async (args, ctx) => {
    if (!args.confirm) {
      throw new ToolError(
        "Applying a plan changes household data and requires confirm=true after the user has reviewed it.",
      );
    }
    const plan = await ctx.store.getPlan(args.plan_id);
    if (!plan) throw new NotFoundError("Plan", args.plan_id);
    if (plan.status === "cancelled") {
      throw new ToolError(`Plan ${plan.id} was cancelled and can no longer be applied.`);
    }
    return ctx.getPlanner().execute(args.plan_id);
  },
});

/* --------------------------------- exports -------------------------------- */

export const toolDefs: AnyToolDef[] = [
  getHouseholdSummary,
  getHouseholdPreferences,
  getActionHistory,
  listTasks,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  listSchedule,
  createScheduleEvent,
  updateScheduleEvent,
  deleteScheduleEvent,
  checkScheduleConflicts,
  listGroceryItems,
  addGroceryItem,
  updateGroceryItem,
  removeGroceryItem,
  markGroceryItemPurchased,
  generateHouseholdPlan,
  validateHouseholdPlan,
  applyApprovedPlan,
];

export const toolDefByName = new Map(toolDefs.map((def) => [def.name, def]));
