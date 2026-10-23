import type { Db } from "./postgres.js";

/**
 * Forward-only, tracked migrations.
 *
 * Every migration is idempotent (IF NOT EXISTS / guarded index creation) and is
 * recorded in `schema_migrations` once it has run, so restarting the server —
 * or pointing it at an already-populated database — never re-applies work and
 * never drops data. There is deliberately no "down" migration and no automatic
 * reset: destructive changes must be made by hand, on purpose.
 */
interface Migration {
  id: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  members TEXT NOT NULL,
  preferences TEXT NOT NULL,
  timezone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  due_date TEXT,
  due_time TEXT,
  assignee TEXT,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'user',
  plan_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  plan_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

CREATE TABLE IF NOT EXISTS grocery_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  category TEXT,
  notes TEXT,
  purchased SMALLINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  plan_id TEXT,
  created_at TEXT NOT NULL,
  purchased_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  request_text TEXT NOT NULL,
  summary TEXT NOT NULL,
  assumptions TEXT NOT NULL DEFAULT '[]',
  clarification TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed',
  provider TEXT NOT NULL,
  provider_mode TEXT NOT NULL DEFAULT 'demo',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT,
  summary TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  origin TEXT NOT NULL DEFAULT 'server'
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts DESC);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
];

/**
 * Apply every pending migration in order, each inside its own transaction.
 *
 * `schema_migrations` is created first (if missing), then only migrations whose
 * id is not yet recorded are run. Because each id is written in the same
 * transaction as its DDL, a crash mid-migration rolls back cleanly and the next
 * boot resumes from the correct point.
 */
export async function runMigrations(db: Db): Promise<{ applied: number[] }> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const appliedRows = await db.all<{ id: number }>("SELECT id FROM schema_migrations ORDER BY id ASC");
  const alreadyApplied = new Set(appliedRows.map((row) => row.id));
  const applied: number[] = [];

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.id)) continue;
    await db.withTransaction(async (tx) => {
      // Split on semicolons so multi-statement DDL runs under the extended
      // protocol too (a single query() call can only run one statement with
      // parameters; with none, pg still allows multiple — but we keep it simple
      // and explicit by executing the whole block via a no-param query).
      await tx.run(migration.sql);
      await tx.run("INSERT INTO schema_migrations (id, name) VALUES (?, ?)", [
        migration.id,
        migration.name,
      ]);
    });
    applied.push(migration.id);
  }

  return { applied };
}

/** Highest applied migration id, or 0 when the database is untouched. */
export async function currentSchemaVersion(db: Db): Promise<number> {
  const exists = await db.get<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_name = 'schema_migrations'
     ) AS exists`,
  );
  if (!exists?.exists) return 0;
  const row = await db.get<{ max: number | null }>("SELECT MAX(id) AS max FROM schema_migrations");
  return row?.max ?? 0;
}
