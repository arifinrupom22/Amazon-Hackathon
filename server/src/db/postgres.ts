import { Pool, type PoolClient, type QueryResult } from "pg";

/**
 * The async database port every service depends on.
 *
 * It deliberately mirrors the shape the old synchronous SQLite store used
 * (`get` / `all` / `run`) so the migration stayed mechanical, but it is
 * asynchronous because PostgreSQL I/O is asynchronous. SQL text still uses
 * SQLite-style `?` placeholders; {@link toPostgresSql} rewrites them to the
 * `$1..$n` form PostgreSQL expects, so queries were not wholesale rewritten.
 */
export interface Db {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Run `fn` inside a transaction; rolls back if it throws. */
  withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Rewrite SQLite `?` placeholders to PostgreSQL `$1..$n`.
 *
 * Every query in this codebase keeps placeholders out of string literals, so a
 * positional counter is sufficient. (A `?` inside a quoted string would be
 * miscounted; none exist today and adding one should revisit this function.)
 */
export function toPostgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/** Anything that can run a parameterised query: a Pool or a checked-out client. */
interface Queryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

class PgDb implements Db {
  /**
   * @param source  the Pool (top level) or a client (inside a transaction)
   * @param pool    present only for the top-level handle, so `withTransaction`
   *                can check out a dedicated client; absent for tx-scoped Db.
   */
  constructor(
    private readonly source: Queryable,
    private readonly pool?: Pool,
    private readonly schema?: string,
  ) {}

  private async exec(sql: string, params: unknown[]): Promise<QueryResult> {
    const text = toPostgresSql(this.schema ? qualifySchema(sql, this.schema) : sql);
    // No params → simple protocol, which (unlike the extended protocol) allows
    // multi-statement strings. This is what the idempotent migrations rely on.
    return params.length === 0 ? this.source.query(text) : this.source.query(text, params);
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.exec(sql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.exec(sql, params);
    return result.rows as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = await this.exec(sql, params);
    return { changes: result.rowCount ?? 0 };
  }

  async withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    // Nested call inside an existing transaction: reuse the current scope.
    if (!this.pool) return fn(this);
    const client: PoolClient = await this.pool.connect();
    const tx = new PgDb(client, undefined, this.schema);
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    // Only the top-level handle owns the pool; transaction-scoped handles must
    // never end it.
    if (this.pool) await this.pool.end();
  }
}

export interface CreateDbOptions {
  databaseUrl: string;
  /**
   * Use a dedicated, isolated schema (search_path) instead of the default.
   * Tests rely on this to run in parallel without colliding; production leaves
   * it undefined and uses the database's default schema.
   */
  schema?: string;
  max?: number;
}

/** Quote a PostgreSQL identifier (schema name) so it is safe to interpolate. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Qualify this app's table references for isolated tests without relying on
 * session search_path, which Neon transaction pooling does not preserve. */
function qualifySchema(sql: string, schema: string): string {
  const tables = "household|tasks|events|grocery_items|plans|activity|meta|schema_migrations";
  const reference = new RegExp(
    `\\b(DELETE\\s+FROM|FROM|JOIN|INTO|UPDATE|TABLE|ON)\\s+(IF\\s+NOT\\s+EXISTS\\s+)?("?)(${tables})\\3\\b`,
    "gi",
  );
  return sql.replace(reference, (_match, keyword: string, ifNotExists: string | undefined, _quote: string, table: string) =>
    `${keyword} ${ifNotExists ?? ""}${quoteIdent(schema)}.${quoteIdent(table)}`,
  );
}

/**
 * Open a pooled connection to PostgreSQL.
 *
 * When `schema` is given, the schema is created first with a throwaway
 * connection, then the real pool is configured so every connection it hands out
 * runs with `search_path` pointing at that schema. This gives each caller an
 * isolated namespace without qualifying every table name.
 */
export async function createDb(options: CreateDbOptions): Promise<Db> {
  const { databaseUrl, schema, max } = options;

  if (schema) {
    // Bootstrap pool with no search_path so CREATE SCHEMA itself can run.
    const bootstrap = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
    } finally {
      await bootstrap.end();
    }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: max ?? 10,
  });

  // Fail fast if the URL is unreachable so callers get a clear error at boot.
  await pool.query("SELECT 1");

  return new PgDb(pool, pool, schema);
}

/** Create the isolated schema up front (used by tests before runMigrations). */
export async function ensureSchema(databaseUrl: string, schema: string): Promise<void> {
  const bootstrap = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
  } finally {
    await bootstrap.end();
  }
}

/** Drop an isolated schema and everything in it (test cleanup; never production). */
export async function dropSchema(databaseUrl: string, schema: string): Promise<void> {
  const bootstrap = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
  } finally {
    await bootstrap.end();
  }
}
