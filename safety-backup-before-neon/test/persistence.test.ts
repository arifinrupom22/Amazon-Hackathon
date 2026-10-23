import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, resetSampleData } from "../src/db/db.js";
import { Store } from "../src/services/store.js";
import { createApp } from "../src/http/app.js";
import { loadConfig } from "../src/config.js";
import { connectMcpClient, parseToolResult } from "./helpers.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Persistence across process restarts: the database is a real file, the server
 * is stopped, a new process-equivalent boots from the same file, and the data
 * must still be there.
 */
describe("SQLite persistence across restarts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homepilot-test-"));
  const dbFile = path.join(dir, "homepilot.db");

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps data after closing and reopening the database file", () => {
    const db = openDatabase(dbFile);
    resetSampleData(db);
    const store = new Store(db);
    const task = store.createTask({ title: "Persisted task", dueDate: "2027-01-15", priority: "high" });
    closeDatabase(db);

    const reopened = openDatabase(dbFile);
    const store2 = new Store(reopened);
    const found = store2.getTask(task.id);
    expect(found.title).toBe("Persisted task");
    expect(found.dueDate).toBe("2027-01-15");
    closeDatabase(reopened);
  });

  it("serves previously written data after a full server restart", async () => {
    const config = loadConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      DATABASE_PATH: dbFile,
      AI_PROVIDER: "demo",
    } as NodeJS.ProcessEnv);

    const boot = async (): Promise<{ server: Server; baseUrl: string; db: ReturnType<typeof openDatabase> }> => {
      const db = openDatabase(dbFile);
      const app = createApp(db, config);
      const server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const { port } = server.address() as AddressInfo;
      return { server, baseUrl: `http://127.0.0.1:${port}`, db };
    };

    const first = await boot();
    const client1 = await connectMcpClient(first.baseUrl);
    const created = parseToolResult(
      await client1.callTool({ name: "create_task", arguments: { title: "Survives restart", due_date: "2027-02-01" } }),
    );
    const taskId = (created.task as { id: string }).id;
    await client1.close();
    await new Promise<void>((resolve) => first.server.close(() => resolve()));
    closeDatabase(first.db);

    const second = await boot();
    const client2 = await connectMcpClient(second.baseUrl);
    const tasks = parseToolResult(await client2.callTool({ name: "list_tasks", arguments: {} })) as {
      tasks: Array<{ id: string; title: string }>;
    };
    expect(tasks.tasks.some((task) => task.id === taskId && task.title === "Survives restart")).toBe(true);

    const summary = parseToolResult(await client2.callTool({ name: "get_household_summary", arguments: {} }));
    expect(summary.household).toMatchObject({ name: "Riverdale Home" });

    await client2.close();
    await new Promise<void>((resolve) => second.server.close(() => resolve()));
    closeDatabase(second.db);
  });
});
