import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, resetSampleData } from "../src/db/db.js";
import { dropSchema } from "../src/db/postgres.js";
import { Store } from "../src/services/store.js";

const databaseUrl = process.env.DATABASE_URL;
const schema = `hp_persist_${randomUUID().replace(/-/g, "")}`;

describe.skipIf(!databaseUrl)("PostgreSQL persistence across restarts", () => {
  afterAll(async () => {
    if (databaseUrl) await dropSchema(databaseUrl, schema);
  });

  it("keeps CRUD data after closing and reopening the database pool", async () => {
    const db = await openDatabase({ databaseUrl: databaseUrl!, schema });
    await resetSampleData(db);
    const task = await new Store(db).createTask({ title: "Persisted task", dueDate: "2027-01-15", priority: "high" });
    await closeDatabase(db);

    const reopened = await openDatabase({ databaseUrl: databaseUrl!, schema });
    const found = await new Store(reopened).getTask(task.id);
    expect(found?.title).toBe("Persisted task");
    expect(found?.dueDate).toBe("2027-01-15");
    await closeDatabase(reopened);
  });

  it("applies schema migrations only once and preserves existing rows", async () => {
    const first = await openDatabase({ databaseUrl: databaseUrl!, schema });
    const store = new Store(first);
    const task = await store.createTask({ title: "Existing row", dueDate: "2027-02-01" });
    await closeDatabase(first);

    const second = await openDatabase({ databaseUrl: databaseUrl!, schema });
    expect((await new Store(second).getTask(task.id))?.title).toBe("Existing row");
    await closeDatabase(second);
  });
});
