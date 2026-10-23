import { newId, nowIso } from "../domain/ids.js";
import { addDaysToKey, nextWeekdayKey, toDateKey } from "../domain/dates.js";
import { createDb, type Db } from "./postgres.js";
import { runMigrations } from "./migrations.js";

export type { Db } from "./postgres.js";

/**
 * Open a pooled PostgreSQL connection, apply any pending migrations, and return
 * the handle. Migrations are forward-only and idempotent, so calling this
 * against an existing, populated database never drops or resets data.
 */
export async function openDatabase(options: {
  databaseUrl: string;
  schema?: string;
  max?: number;
}): Promise<Db> {
  const db = await createDb(options);
  await runMigrations(db);
  return db;
}

export async function closeDatabase(db: Db): Promise<void> {
  await db.close();
}

/* ------------------------------------------------------------------------- */
/* Sample household data                                                      */
/* ------------------------------------------------------------------------- */

function isoOffset(days: number): string {
  return addDaysToKey(toDateKey(), days);
}

/** Next occurrence of a weekday (0 = Sunday … 6 = Saturday), today counts if matches. */
export function nextWeekday(target: number, fromKey: string = toDateKey()): string {
  return nextWeekdayKey(target, fromKey);
}

/**
 * Seed the deterministic sample household used by the demo and by tests.
 *
 * This *does* clear existing rows first (it is a demo reset). It is only ever
 * invoked explicitly (the /api/demo/reset endpoint or a test),
 * never automatically on boot against a populated database.
 */
export async function resetSampleData(db: Db): Promise<void> {
  await db.withTransaction(async (tx) => {
    await tx.run(
      "DELETE FROM activity; DELETE FROM plans; DELETE FROM tasks; DELETE FROM events; DELETE FROM grocery_items; DELETE FROM household;",
    );

    const householdId = newId("hh");
    const members = [
      { id: newId("mem"), name: "Elena Vance", role: "Household lead", presence: "Home" },
      { id: newId("mem"), name: "Marcus Vance", role: "Partner", presence: "Office" },
      { id: newId("mem"), name: "Leo Vance", role: "Kid", presence: "School" },
    ];
    await tx.run(
      "INSERT INTO household (id, name, members, preferences, timezone, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        householdId,
        "Riverdale Home",
        JSON.stringify(members),
        JSON.stringify({
          diet: "Mostly vegetarian, no shellfish",
          quietHours: "21:30 – 07:00",
          cleaningDay: "Saturday afternoon",
          shoppingDay: "Saturday morning",
          defaultStore: "Riverdale Market",
          notes: "Guests remove shoes at the entry. Leo has soccer on weekday evenings.",
        }),
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? "America/New_York",
        nowIso(),
      ],
    );

    const today = isoOffset(0);
    const tomorrow = isoOffset(1);
    const insertTask = async (
      title: string,
      notes: string | null,
      dueDate: string,
      dueTime: string | null,
      assignee: string,
      category: string,
      priority: string,
      status: string,
    ) => {
      await tx.run(
        `INSERT INTO tasks (id, title, notes, due_date, due_time, assignee, category, priority, status, source, plan_id, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', NULL, ?, NULL)`,
        [newId("tsk"), title, notes, dueDate, dueTime, assignee, category, priority, status, nowIso()],
      );
    };
    await insertTask(
      "Clean guest bathroom and restock towels",
      "Under-sink cupboard has spare towels",
      today,
      "10:00",
      "Elena Vance",
      "Cleaning",
      "medium",
      "completed",
    );
    await insertTask(
      "Pick up Leo from soccer practice",
      "Practice ends at the north field",
      today,
      "17:15",
      "Marcus Vance",
      "Family",
      "high",
      "open",
    );
    await insertTask(
      "Refill Leo's inhaler prescription",
      null,
      tomorrow,
      null,
      "Elena Vance",
      "Health",
      "low",
      "open",
    );
    await insertTask(
      "Take recycling to the curb",
      "Bin day is Tuesday",
      isoOffset(2),
      "20:00",
      "Marcus Vance",
      "Household",
      "low",
      "open",
    );

    const insertEvent = async (
      title: string,
      date: string,
      startTime: string | null,
      endTime: string | null,
      location: string | null,
      notes: string | null,
    ) => {
      await tx.run(
        `INSERT INTO events (id, title, date, start_time, end_time, location, notes, source, plan_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'user', NULL, ?)`,
        [newId("evt"), title, date, startTime, endTime, location, notes, nowIso()],
      );
    };
    await insertEvent("Marcus — workday", today, "09:00", "17:00", "Downtown office", null);
    await insertEvent("Leo soccer practice", today, "16:00", "17:00", "North field", null);
    await insertEvent(
      "Dinner with the Hendersons",
      nextWeekday(6),
      "19:00",
      "21:00",
      "Home — dining room",
      "Bringing their famous lemon tart",
    );

    const insertGrocery = async (
      name: string,
      quantity: number,
      unit: string | null,
      category: string | null,
      notes: string | null,
      purchased: number,
    ) => {
      await tx.run(
        `INSERT INTO grocery_items (id, name, quantity, unit, category, notes, purchased, source, plan_id, created_at, purchased_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'user', NULL, ?, NULL)`,
        [newId("gro"), name, quantity, unit, category, notes, purchased, nowIso()],
      );
    };
    await insertGrocery("Oat milk (barista)", 2, "cartons", "Dairy & alternatives", null, 1);
    await insertGrocery("Jasmine rice", 1, "kg", "Pantry", "Low stock", 0);
    await insertGrocery("Baby spinach", 2, "bags", "Produce", null, 0);
    await insertGrocery("Sparkling water", 6, "cans", "Beverages", null, 0);

    await tx.run(
      `INSERT INTO activity (id, ts, kind, tool, summary, detail, status, origin) VALUES (?, ?, 'system', NULL, ?, ?, 'ok', 'server')`,
      [newId("act"), nowIso(), "Sample household data loaded", JSON.stringify({ note: "resetSampleData()" })],
    );
  });
}

/** True only when no household data exists anywhere in the migrated schema. */
export async function isDatabaseEmpty(db: Db): Promise<boolean> {
  const row = await db.get<{ empty: boolean }>(`SELECT NOT EXISTS (
    SELECT 1 FROM household
    UNION ALL SELECT 1 FROM tasks
    UNION ALL SELECT 1 FROM events
    UNION ALL SELECT 1 FROM grocery_items
    UNION ALL SELECT 1 FROM plans
    UNION ALL SELECT 1 FROM activity
    UNION ALL SELECT 1 FROM meta
  ) AS empty`);
  return row?.empty === true;
}

/** Wipe everything and reload the sample household. Explicit demo reset only. */
export async function reseed(db: Db): Promise<void> {
  await resetSampleData(db);
}
