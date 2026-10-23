import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { connectMcpClient, parseToolResult, startTestServer, type TestServer } from "./helpers.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Integration tests that exercise the real MCP endpoint over Streamable HTTP
 * with the official TypeScript SDK client — the same code path the web app uses.
 */
describe.skipIf(!process.env.DATABASE_URL)("MCP endpoint (Streamable HTTP + official client)", () => {
  let ctx: TestServer;
  let client: Client;

  beforeAll(async () => {
    ctx = await startTestServer();
    client = await connectMcpClient(ctx.baseUrl);
  });

  afterAll(async () => {
    await client?.close();
    await ctx?.close();
  });

  it("negotiates the protocol during initialize", async () => {
    const serverInfo = client.getServerVersion();
    expect(serverInfo?.name).toBe("homepilot-ai");
    expect(client.getServerCapabilities()?.tools).toBeDefined();
    const version = client.getServerVersion();
    expect(version?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("lists every registered tool with a description and input schema", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("get_household_summary");
    expect(names).toContain("create_task");
    expect(names).toContain("check_schedule_conflicts");
    expect(names).toContain("generate_household_plan");
    expect(names).toContain("apply_approved_plan");
    expect(names).toHaveLength(21);

    for (const tool of tools) {
      expect((tool.description ?? "").length, `${tool.name} needs a description`).toBeGreaterThan(20);
      expect(tool.inputSchema, `${tool.name} needs an input schema`).toBeDefined();
    }

    const createTask = tools.find((tool) => tool.name === "create_task")!;
    expect(createTask.inputSchema).toMatchObject({ type: "object" });
    expect(JSON.stringify(createTask.inputSchema)).toContain("title");
  });

  it("returns household context through get_household_summary", async () => {
    const result = parseToolResult(await client.callTool({ name: "get_household_summary", arguments: {} }));
    expect(result.household).toMatchObject({ name: "Riverdale Home" });
    expect((result.members as unknown[]).length).toBe(3);
    expect(result.counts).toBeDefined();
  });

  it("returns recent audit entries through get_action_history", async () => {
    const result = parseToolResult(
      await client.callTool({ name: "get_action_history", arguments: { limit: 3 } }),
    );
    expect(result.count).toBeLessThanOrEqual(3);
    const entries = result.entries as Array<{ ts: string; summary: string; status: string }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.summary.length).toBeGreaterThan(5);
  });

  it("creates, lists, completes and deletes a task", async () => {
    const created = parseToolResult(
      await client.callTool({
        name: "create_task",
        arguments: { title: "Test: rotate the mattress", due_date: "2026-11-02", priority: "low" },
      }),
    );
    expect(created.created).toBe(true);
    const task = created.task as { id: string; status: string };
    expect(task.status).toBe("open");

    const listed = parseToolResult(await client.callTool({ name: "list_tasks", arguments: { status: "open" } }));
    expect((listed.tasks as Array<{ id: string }>).some((t) => t.id === task.id)).toBe(true);

    const completed = parseToolResult(await client.callTool({ name: "complete_task", arguments: { id: task.id } }));
    expect(completed.task).toMatchObject({ status: "completed" });

    const deleted = parseToolResult(
      await client.callTool({ name: "delete_task", arguments: { id: task.id, confirm: true } }),
    );
    expect(deleted.deleted).toBe(true);

    const listedAgain = parseToolResult(await client.callTool({ name: "list_tasks", arguments: {} }));
    expect((listedAgain.tasks as Array<{ id: string }>).some((t) => t.id === task.id)).toBe(false);
  });

  it("refuses duplicate open tasks unless allow_duplicate is set", async () => {
    const args = { title: "Test: buy dishwasher tablets", due_date: "2026-11-05" };
    const first = parseToolResult(await client.callTool({ name: "create_task", arguments: args }));
    expect(first.created).toBe(true);

    const second = parseToolResult(await client.callTool({ name: "create_task", arguments: args }));
    expect(second.created).toBe(false);
    expect(second.duplicate).toBe(true);

    const third = parseToolResult(
      await client.callTool({ name: "create_task", arguments: { ...args, allow_duplicate: true } }),
    );
    expect(third.created).toBe(true);
  });

  it("returns a tool error (isError) for invalid input instead of crashing", async () => {
    const result = await client.callTool({ name: "create_task", arguments: { title: "" } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(text).toMatch(/title|Invalid/i);

    const badDate = await client.callTool({
      name: "create_task",
      arguments: { title: "Valid title", due_date: "next tuesday" },
    });
    expect(badDate.isError).toBe(true);
    expect((badDate.content as Array<{ text?: string }>)[0]?.text).toMatch(/YYYY-MM-DD/);
  });

  it("reports missing records safely", async () => {
    const result = await client.callTool({ name: "complete_task", arguments: { id: "tsk_missing" } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text?: string }>)[0]?.text).toMatch(/was not found/);
  });

  it("requires confirm=true for destructive tools", async () => {
    const listed = parseToolResult(await client.callTool({ name: "list_grocery_items", arguments: {} }));
    const itemId = (listed.items as Array<{ id: string }>)[0].id;

    const refused = await client.callTool({ name: "remove_grocery_item", arguments: { id: itemId } });
    expect(refused.isError).toBe(true);
    expect((refused.content as Array<{ text?: string }>)[0]?.text).toMatch(/confirm=true/);

    const removed = parseToolResult(
      await client.callTool({ name: "remove_grocery_item", arguments: { id: itemId, confirm: true } }),
    );
    expect(removed.deleted).toBe(true);
  });

  it("adds, merges and purchases grocery items", async () => {
    const added = parseToolResult(
      await client.callTool({ name: "add_grocery_item", arguments: { name: "Test hummus", quantity: 1, unit: "tubs" } }),
    );
    expect(added.created).toBe(true);

    const merged = parseToolResult(
      await client.callTool({ name: "add_grocery_item", arguments: { name: "Test hummus", quantity: 2, unit: "tubs" } }),
    );
    expect(merged.merged).toBe(true);
    expect((merged.item as { quantity: number }).quantity).toBe(3);

    const id = (merged.item as { id: string }).id;
    const purchased = parseToolResult(
      await client.callTool({ name: "mark_grocery_item_purchased", arguments: { id } }),
    );
    expect((purchased.item as { purchased: boolean }).purchased).toBe(true);

    const unpurchased = parseToolResult(
      await client.callTool({ name: "mark_grocery_item_purchased", arguments: { id, purchased: false } }),
    );
    expect((unpurchased.item as { purchased: boolean }).purchased).toBe(false);
  });

  it("detects schedule conflicts for candidate and existing events", async () => {
    const dinner = parseToolResult(await client.callTool({ name: "list_schedule", arguments: {} }));
    const dinnerEvent = (dinner.events as Array<{ date: string; title: string }>).find((e) =>
      /Henderson/i.test(e.title),
    )!;

    const conflicts = parseToolResult(
      await client.callTool({
        name: "check_schedule_conflicts",
        arguments: { date: dinnerEvent.date, title: "Overlapping test block", start_time: "19:30", end_time: "20:30" },
      }),
    );
    expect(conflicts.hasConflicts).toBe(true);
    expect((conflicts.conflicts as unknown[]).length).toBeGreaterThan(0);

    const clear = parseToolResult(
      await client.callTool({
        name: "check_schedule_conflicts",
        arguments: { date: "2030-01-01", title: "Quiet block", start_time: "08:00", end_time: "09:00" },
      }),
    );
    expect(clear.hasConflicts).toBe(false);
  });

  it("surfaces unknown tool names as an error result", async () => {
    const result = await client.callTool({ name: "teleport_dishes", arguments: {} }).catch((error: unknown) => error);
    if (result instanceof Error) {
      expect(result).toBeInstanceOf(McpError);
    } else {
      expect((result as { isError?: boolean }).isError).toBe(true);
    }
  });
});
