import type { Db } from "../db/db.js";
import { newId, nowIso } from "../domain/ids.js";
import { toDateKey } from "../domain/dates.js";
import type {
  ActivityEntry,
  EventCreateInput,
  GroceryCreateInput,
  GroceryItem,
  Household,
  HouseholdPreferences,
  Plan,
  PlanAction,
  PlanStatus,
  PlanWarning,
  ScheduleEvent,
  Task,
  TaskCreateInput,
} from "../domain/types.js";

/* ----------------------------- row mappers -------------------------------- */

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  assignee: string | null;
  category: string | null;
  priority: Task["priority"];
  status: Task["status"];
  source: Task["source"];
  plan_id: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    dueDate: row.due_date,
    dueTime: row.due_time,
    assignee: row.assignee,
    category: row.category,
    priority: row.priority,
    status: row.status,
    source: row.source,
    planId: row.plan_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

interface EventRow {
  id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  source: ScheduleEvent["source"];
  plan_id: string | null;
  created_at: string;
}

function mapEvent(row: EventRow): ScheduleEvent {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    notes: row.notes,
    source: row.source,
    planId: row.plan_id,
    createdAt: row.created_at,
  };
}

interface GroceryRow {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  category: string | null;
  notes: string | null;
  purchased: number;
  source: GroceryItem["source"];
  plan_id: string | null;
  created_at: string;
  purchased_at: string | null;
}

function mapGrocery(row: GroceryRow): GroceryItem {
  return {
    id: row.id,
    name: row.name,
    // PostgreSQL REAL comes back as a JS number; normalise away float noise.
    quantity: Math.round(Number(row.quantity) * 1000) / 1000,
    unit: row.unit,
    category: row.category,
    notes: row.notes,
    purchased: row.purchased === 1,
    source: row.source,
    planId: row.plan_id,
    createdAt: row.created_at,
    purchasedAt: row.purchased_at,
  };
}

/* -------------------------------- Store ----------------------------------- */

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} with id "${id}" was not found.`);
    this.name = "NotFoundError";
  }
}

/**
 * Async data-access layer over PostgreSQL.
 *
 * Every method is asynchronous because PostgreSQL I/O is asynchronous. Callers
 * (the planner, the MCP tool registry and the HTTP routes) await these, which
 * is what made the SQLite→Postgres migration a mechanical, behaviour-preserving
 * change rather than a redesign.
 */
export class Store {
  constructor(private readonly db: Db) {}

  /* ------------------------------ household ------------------------------ */

  async getHousehold(): Promise<Household> {
    const row = await this.db.get<{
      id: string;
      name: string;
      members: string;
      preferences: string;
      timezone: string;
      updated_at: string;
    }>("SELECT id, name, members, preferences, timezone, updated_at FROM household LIMIT 1");
    if (!row) {
      throw new Error("No household configured. Run the seed (resetSampleData) first.");
    }
    return {
      id: row.id,
      name: row.name,
      members: JSON.parse(row.members),
      preferences: JSON.parse(row.preferences),
      timezone: row.timezone,
      updatedAt: row.updated_at,
    };
  }

  async updateHousehold(input: { name?: string; preferences?: Partial<HouseholdPreferences> }): Promise<Household> {
    const current = await this.getHousehold();
    const preferences = { ...current.preferences, ...(input.preferences ?? {}) };
    await this.db.run("UPDATE household SET name = ?, preferences = ?, updated_at = ? WHERE id = ?", [
      input.name ?? current.name,
      JSON.stringify(preferences),
      nowIso(),
      current.id,
    ]);
    return this.getHousehold();
  }

  async memberNames(): Promise<string[]> {
    const household = await this.getHousehold();
    return household.members.map((m) => m.name);
  }

  /* -------------------------------- tasks --------------------------------- */

  async listTasks(filter: { status?: Task["status"]; dueDate?: string; assignee?: string } = {}): Promise<Task[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.dueDate) {
      clauses.push("due_date = ?");
      params.push(filter.dueDate);
    }
    if (filter.assignee) {
      clauses.push("assignee = ?");
      params.push(filter.assignee);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<TaskRow>(
      `SELECT * FROM tasks ${where} ORDER BY status ASC, due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, created_at ASC`,
      params,
    );
    return rows.map(mapTask);
  }

  async getTask(id: string): Promise<Task> {
    const row = await this.db.get<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
    if (!row) throw new NotFoundError("Task", id);
    return mapTask(row);
  }

  async findOpenDuplicateTask(title: string, dueDate: string | null): Promise<Task | undefined> {
    const rows = await this.db.all<TaskRow>(
      "SELECT * FROM tasks WHERE status = 'open' AND lower(title) = lower(?)",
      [title.trim()],
    );
    return rows.map(mapTask).find((task) => task.dueDate === (dueDate ?? null));
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const id = newId("tsk");
    await this.db.run(
      `INSERT INTO tasks (id, title, notes, due_date, due_time, assignee, category, priority, status, source, plan_id, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL)`,
      [
        id,
        input.title.trim(),
        input.notes ?? null,
        input.dueDate ?? null,
        input.dueTime ?? null,
        input.assignee ?? null,
        input.category ?? null,
        input.priority ?? "medium",
        input.source ?? "user",
        input.planId ?? null,
        nowIso(),
      ],
    );
    return this.getTask(id);
  }

  async updateTask(
    id: string,
    patch: Partial<Omit<TaskCreateInput, "source" | "planId">> & { status?: Task["status"] },
  ): Promise<Task> {
    const task = await this.getTask(id);
    const next = {
      title: patch.title?.trim() || task.title,
      notes: patch.notes !== undefined ? patch.notes : task.notes,
      dueDate: patch.dueDate !== undefined ? patch.dueDate : task.dueDate,
      dueTime: patch.dueTime !== undefined ? patch.dueTime : task.dueTime,
      assignee: patch.assignee !== undefined ? patch.assignee : task.assignee,
      category: patch.category !== undefined ? patch.category : task.category,
      priority: patch.priority ?? task.priority,
      status: patch.status ?? task.status,
      completedAt: (patch.status ?? task.status) === "completed" ? (task.completedAt ?? nowIso()) : null,
    };
    await this.db.run(
      `UPDATE tasks SET title = ?, notes = ?, due_date = ?, due_time = ?, assignee = ?, category = ?, priority = ?, status = ?, completed_at = ? WHERE id = ?`,
      [
        next.title,
        next.notes,
        next.dueDate,
        next.dueTime,
        next.assignee,
        next.category,
        next.priority,
        next.status,
        next.completedAt,
        id,
      ],
    );
    return this.getTask(id);
  }

  async completeTask(id: string): Promise<Task> {
    await this.getTask(id);
    await this.db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [nowIso(), id]);
    return this.getTask(id);
  }

  async deleteTask(id: string): Promise<{ id: string; deleted: true; title: string }> {
    const task = await this.getTask(id);
    await this.db.run("DELETE FROM tasks WHERE id = ?", [id]);
    return { id, deleted: true, title: task.title };
  }

  /* -------------------------------- events -------------------------------- */

  async listEvents(filter: { date?: string; from?: string; to?: string } = {}): Promise<ScheduleEvent[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.date) {
      clauses.push("date = ?");
      params.push(filter.date);
    }
    if (filter.from) {
      clauses.push("date >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      clauses.push("date <= ?");
      params.push(filter.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<EventRow>(
      `SELECT * FROM events ${where} ORDER BY date ASC, start_time IS NULL, start_time ASC`,
      params,
    );
    return rows.map(mapEvent);
  }

  async getEvent(id: string): Promise<ScheduleEvent> {
    const row = await this.db.get<EventRow>("SELECT * FROM events WHERE id = ?", [id]);
    if (!row) throw new NotFoundError("Schedule event", id);
    return mapEvent(row);
  }

  async createEvent(input: EventCreateInput): Promise<ScheduleEvent> {
    const id = newId("evt");
    await this.db.run(
      `INSERT INTO events (id, title, date, start_time, end_time, location, notes, source, plan_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title.trim(),
        input.date,
        input.startTime ?? null,
        input.endTime ?? null,
        input.location ?? null,
        input.notes ?? null,
        input.source ?? "user",
        input.planId ?? null,
        nowIso(),
      ],
    );
    return this.getEvent(id);
  }

  async updateEvent(
    id: string,
    patch: Partial<Omit<EventCreateInput, "source" | "planId">>,
  ): Promise<ScheduleEvent> {
    const event = await this.getEvent(id);
    const next = {
      title: patch.title?.trim() || event.title,
      date: patch.date || event.date,
      startTime: patch.startTime !== undefined ? patch.startTime : event.startTime,
      endTime: patch.endTime !== undefined ? patch.endTime : event.endTime,
      location: patch.location !== undefined ? patch.location : event.location,
      notes: patch.notes !== undefined ? patch.notes : event.notes,
    };
    await this.db.run(
      "UPDATE events SET title = ?, date = ?, start_time = ?, end_time = ?, location = ?, notes = ? WHERE id = ?",
      [next.title, next.date, next.startTime, next.endTime, next.location, next.notes, id],
    );
    return this.getEvent(id);
  }

  async deleteEvent(id: string): Promise<{ id: string; deleted: true; title: string }> {
    const event = await this.getEvent(id);
    await this.db.run("DELETE FROM events WHERE id = ?", [id]);
    return { id, deleted: true, title: event.title };
  }

  /* ------------------------------ groceries ------------------------------- */

  async listGroceries(filter: { includePurchased?: boolean } = {}): Promise<GroceryItem[]> {
    const where = filter.includePurchased ? "" : "WHERE purchased = 0";
    const rows = await this.db.all<GroceryRow>(
      `SELECT * FROM grocery_items ${where} ORDER BY purchased ASC, category ASC, name ASC`,
    );
    return rows.map(mapGrocery);
  }

  async getGrocery(id: string): Promise<GroceryItem> {
    const row = await this.db.get<GroceryRow>("SELECT * FROM grocery_items WHERE id = ?", [id]);
    if (!row) throw new NotFoundError("Grocery item", id);
    return mapGrocery(row);
  }

  async findDuplicateGrocery(name: string): Promise<GroceryItem | undefined> {
    const row = await this.db.get<GroceryRow>(
      "SELECT * FROM grocery_items WHERE lower(name) = lower(?) AND purchased = 0",
      [name.trim()],
    );
    return row ? mapGrocery(row) : undefined;
  }

  async addGrocery(input: GroceryCreateInput): Promise<GroceryItem> {
    const id = newId("gro");
    await this.db.run(
      `INSERT INTO grocery_items (id, name, quantity, unit, category, notes, purchased, source, plan_id, created_at, purchased_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)`,
      [
        id,
        input.name.trim(),
        input.quantity ?? 1,
        input.unit ?? null,
        input.category ?? null,
        input.notes ?? null,
        input.source ?? "user",
        input.planId ?? null,
        nowIso(),
      ],
    );
    return this.getGrocery(id);
  }

  async updateGrocery(
    id: string,
    patch: Partial<Omit<GroceryCreateInput, "source" | "planId">>,
  ): Promise<GroceryItem> {
    const item = await this.getGrocery(id);
    const next = {
      name: patch.name?.trim() || item.name,
      quantity: patch.quantity ?? item.quantity,
      unit: patch.unit !== undefined ? patch.unit : item.unit,
      category: patch.category !== undefined ? patch.category : item.category,
      notes: patch.notes !== undefined ? patch.notes : item.notes,
    };
    await this.db.run(
      "UPDATE grocery_items SET name = ?, quantity = ?, unit = ?, category = ?, notes = ? WHERE id = ?",
      [next.name, next.quantity, next.unit, next.category, next.notes, id],
    );
    return this.getGrocery(id);
  }

  async setGroceryPurchased(id: string, purchased: boolean): Promise<GroceryItem> {
    await this.getGrocery(id);
    await this.db.run("UPDATE grocery_items SET purchased = ?, purchased_at = ? WHERE id = ?", [
      purchased ? 1 : 0,
      purchased ? nowIso() : null,
      id,
    ]);
    return this.getGrocery(id);
  }

  async removeGrocery(id: string): Promise<{ id: string; deleted: true; name: string }> {
    const item = await this.getGrocery(id);
    await this.db.run("DELETE FROM grocery_items WHERE id = ?", [id]);
    return { id, deleted: true, name: item.name };
  }

  /* -------------------------------- plans --------------------------------- */

  async savePlan(plan: Plan): Promise<void> {
    await this.db.run(
      `INSERT INTO plans (id, title, request_text, summary, assumptions, clarification, warnings, actions, status, provider, provider_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary,
         assumptions = excluded.assumptions,
         clarification = excluded.clarification,
         warnings = excluded.warnings,
         actions = excluded.actions,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [
        plan.id,
        plan.title,
        plan.requestText,
        plan.summary,
        JSON.stringify(plan.assumptions),
        plan.clarification,
        JSON.stringify(plan.warnings),
        JSON.stringify(plan.actions),
        plan.status,
        plan.provider,
        plan.providerMode,
        plan.createdAt,
        nowIso(),
      ],
    );
  }

  async getPlan(id: string): Promise<Plan | undefined> {
    const row = await this.db.get<Record<string, unknown>>("SELECT * FROM plans WHERE id = ?", [id]);
    if (!row) return undefined;
    return {
      id: row.id as string,
      title: row.title as string,
      requestText: row.request_text as string,
      summary: row.summary as string,
      assumptions: JSON.parse(row.assumptions as string),
      clarification: (row.clarification as string | null) ?? null,
      warnings: JSON.parse(row.warnings as string),
      actions: JSON.parse(row.actions as string) as PlanAction[],
      status: row.status as PlanStatus,
      provider: row.provider as string,
      providerMode: row.provider_mode as "demo" | "live",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  async listPlans(limit = 20): Promise<Plan[]> {
    const rows = await this.db.all<{ id: string }>(
      "SELECT id FROM plans ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
    const plans: Plan[] = [];
    for (const row of rows) {
      const plan = await this.getPlan(row.id);
      if (plan) plans.push(plan);
    }
    return plans;
  }

  async updatePlan(
    id: string,
    patch: Partial<Pick<Plan, "title" | "summary" | "assumptions" | "clarification" | "warnings" | "actions" | "status">>,
  ): Promise<Plan> {
    const plan = await this.getPlan(id);
    if (!plan) throw new NotFoundError("Plan", id);
    const next: Plan = { ...plan, ...patch };
    await this.savePlan(next);
    return (await this.getPlan(id))!;
  }

  /* ------------------------------- activity ------------------------------- */

  async logActivity(entry: Omit<ActivityEntry, "id" | "ts"> & { ts?: string }): Promise<ActivityEntry> {
    const full: ActivityEntry = {
      id: newId("act"),
      ts: entry.ts ?? nowIso(),
      kind: entry.kind,
      tool: entry.tool,
      summary: entry.summary,
      detail: entry.detail,
      status: entry.status,
      origin: entry.origin,
    };
    await this.db.run(
      "INSERT INTO activity (id, ts, kind, tool, summary, detail, status, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [full.id, full.ts, full.kind, full.tool, full.summary, JSON.stringify(full.detail ?? null), full.status, full.origin],
    );
    return full;
  }

  async listActivity(limit = 50): Promise<ActivityEntry[]> {
    const rows = await this.db.all<{
      id: string;
      ts: string;
      kind: ActivityEntry["kind"];
      tool: string | null;
      summary: string;
      detail: string | null;
      status: ActivityEntry["status"];
      origin: ActivityEntry["origin"];
    }>("SELECT * FROM activity ORDER BY ts DESC, id DESC LIMIT ?", [limit]);
    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      kind: row.kind,
      tool: row.tool,
      summary: row.summary,
      detail: row.detail ? JSON.parse(row.detail) : null,
      status: row.status,
      origin: row.origin,
    }));
  }

  async clearActivity(): Promise<void> {
    await this.db.run("DELETE FROM activity");
  }

  /* -------------------------------- summary -------------------------------- */

  async summary(): Promise<{
    openTasks: number;
    completedTasks: number;
    todayTasks: number;
    upcomingEvents: number;
    todayEvents: number;
    groceriesToBuy: number;
    groceriesPurchased: number;
  }> {
    const today = toDateKey();
    const count = async (sql: string, params: unknown[] = []): Promise<number> => {
      const row = await this.db.get<{ n: string | number }>(sql, params);
      return Number(row?.n ?? 0);
    };
    const [openTasks, completedTasks, todayTasks, upcomingEvents, todayEvents, groceriesToBuy, groceriesPurchased] =
      await Promise.all([
        count("SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'"),
        count("SELECT COUNT(*) AS n FROM tasks WHERE status = 'completed'"),
        count("SELECT COUNT(*) AS n FROM tasks WHERE due_date = ? AND status = 'open'", [today]),
        count("SELECT COUNT(*) AS n FROM events WHERE date >= ?", [today]),
        count("SELECT COUNT(*) AS n FROM events WHERE date = ?", [today]),
        count("SELECT COUNT(*) AS n FROM grocery_items WHERE purchased = 0"),
        count("SELECT COUNT(*) AS n FROM grocery_items WHERE purchased = 1"),
      ]);
    return {
      openTasks,
      completedTasks,
      todayTasks,
      upcomingEvents,
      todayEvents,
      groceriesToBuy,
      groceriesPurchased,
    };
  }
}
