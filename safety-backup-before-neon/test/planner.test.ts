import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseToolResult, startTestServer, connectMcpClient, type TestServer } from "./helpers.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Plan } from "../src/domain/types.js";

const REQUEST =
  "Plan a relaxed Saturday for two. Add grocery items for dinner, schedule a cleaning session in the afternoon, and remind me to prepare dinner before 7 PM.";

describe("Plan review and safe execution", () => {
  let ctx: TestServer;
  let client: Client;

  const propose = async (request = REQUEST): Promise<Plan> => {
    const response = await fetch(`${ctx.baseUrl}/api/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { plan: Plan };
    return body.plan;
  };

  beforeAll(async () => {
    ctx = await startTestServer();
    client = await connectMcpClient(ctx.baseUrl);
  });

  afterAll(async () => {
    await client?.close();
    await ctx?.close();
  });

  it("proposes a structured plan without touching the database", async () => {
    const beforeTasks = parseToolResult(await client.callTool({ name: "list_tasks", arguments: {} })).count as number;
    const beforeGroceries = parseToolResult(await client.callTool({ name: "list_grocery_items", arguments: {} }))
      .count as number;

    const plan = await propose();
    expect(plan.status).toBe("proposed");
    expect(plan.actions.length).toBeGreaterThanOrEqual(3);
    expect(plan.assumptions.length).toBeGreaterThan(0);
    expect(plan.actions.every((action) => action.status === "pending")).toBe(true);
    expect(plan.actions.map((action) => action.tool)).toContain("add_grocery_item");
    expect(plan.actions.map((action) => action.tool)).toContain("create_schedule_event");
    expect(plan.actions.map((action) => action.tool)).toContain("create_task");

    const afterTasks = parseToolResult(await client.callTool({ name: "list_tasks", arguments: {} })).count as number;
    const afterGroceries = parseToolResult(await client.callTool({ name: "list_grocery_items", arguments: {} }))
      .count as number;
    expect(afterTasks).toBe(beforeTasks);
    expect(afterGroceries).toBe(beforeGroceries);
  });

  it("flags scheduling warnings and re-validates on the server", async () => {
    const plan = await propose();
    const response = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actions: [] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plan: Plan; warnings: Plan["warnings"]; valid: boolean };
    expect(body.valid).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it("lets the user disable actions before approval and skips them on execution", async () => {
    const plan = await propose();
    const groceryActions = plan.actions.filter((action) => action.tool === "add_grocery_item");
    expect(groceryActions.length).toBeGreaterThan(1);

    const patched = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actions: groceryActions.map((action) => ({ id: action.id, apply: false })) }),
    });
    const patchedBody = (await patched.json()) as { plan: Plan };
    expect(patchedBody.plan.actions.filter((action) => action.tool === "add_grocery_item").every((a) => !a.apply)).toBe(
      true,
    );

    const groceriesBefore = parseToolResult(await client.callTool({ name: "list_grocery_items", arguments: {} }))
      .count as number;

    const approved = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}/approve`, { method: "POST" });
    expect(approved.status).toBe(200);
    const result = (await approved.json()) as {
      status: string;
      results: Array<{ status: string; tool: string }>;
      appliedCount: number;
    };
    expect(result.status).toBe("applied");
    expect(result.results.find((r) => r.tool === "add_grocery_item")?.status).toBe("skipped");
    expect(result.results.find((r) => r.tool === "create_task")?.status).toBe("applied");

    const groceriesAfter = parseToolResult(await client.callTool({ name: "list_grocery_items", arguments: {} }))
      .count as number;
    expect(groceriesAfter).toBe(groceriesBefore);
  });

  it("applies an approved plan through real MCP tools and persists the results", async () => {
    const plan = await propose(
      "Plan a birthday brunch for four. Add breakfast groceries, schedule a cake pickup on Saturday at 11 AM, and remind me to order candles before 6 PM.",
    );
    const response = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}/approve`, { method: "POST" });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      status: string;
      appliedCount: number;
      failedCount: number;
      results: Array<{ entityId: string | null; message: string }>;
    };
    expect(result.status).toBe("applied");
    expect(result.appliedCount).toBeGreaterThan(0);
    expect(result.failedCount).toBe(0);
    expect(result.results.some((r) => r.entityId !== null)).toBe(true);

    // The created records are visible through the MCP endpoint.
    const tasks = parseToolResult(await client.callTool({ name: "list_tasks", arguments: {} })) as {
      tasks: Array<{ planId: string | null; title: string }>;
    };
    const fromPlan = tasks.tasks.filter((task) => task.planId === plan.id);
    expect(fromPlan.length).toBeGreaterThan(0);
    expect(fromPlan.some((task) => /candles/i.test(task.title))).toBe(true);

    const groceries = parseToolResult(await client.callTool({ name: "list_grocery_items", arguments: {} })) as {
      items: Array<{ planId: string | null }>;
    };
    expect(groceries.items.filter((item) => item.planId === plan.id).length).toBeGreaterThan(0);
  });

  it("refuses to apply the same plan twice", async () => {
    const plan = await propose();
    await fetch(`${ctx.baseUrl}/api/plans/${plan.id}/approve`, { method: "POST" });
    const second = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}/approve`, { method: "POST" });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/already been applied/);
  });

  it("cancels a plan so nothing is applied", async () => {
    const plan = await propose();
    const tasksBefore = parseToolResult(await client.callTool({ name: "list_tasks", arguments: {} })).count as number;

    const cancelled = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(200);

    const apply = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}/approve`, { method: "POST" });
    expect(apply.status).toBe(409);

    const tasksAfter = parseToolResult(await client.callTool({ name: "list_tasks", arguments: {} })).count as number;
    expect(tasksAfter).toBe(tasksBefore);
  });

  it("exposes generate/validate/apply as MCP tools too", async () => {
    const generated = parseToolResult(
      await client.callTool({
        name: "generate_household_plan",
        arguments: { request: "Add oat milk and sourdough bread to the grocery list and remind me to call the plumber at 5 PM tomorrow." },
      }),
    );
    const plan = generated.plan as Plan;
    expect(plan.status).toBe("proposed");

    const validation = parseToolResult(
      await client.callTool({ name: "validate_household_plan", arguments: { plan_id: plan.id } }),
    );
    expect(validation.valid).toBe(true);

    const unconfirmed = await client.callTool({ name: "apply_approved_plan", arguments: { plan_id: plan.id } });
    expect(unconfirmed.isError).toBe(true);

    const applied = parseToolResult(
      await client.callTool({ name: "apply_approved_plan", arguments: { plan_id: plan.id, confirm: true } }),
    );
    expect(applied.status).toBe("applied");
  });

  it("blocks actions whose tool arguments are invalid", async () => {
    const plan = await propose();
    const action = plan.actions.find((a) => a.tool === "create_task")!;
    const patched = await fetch(`${ctx.baseUrl}/api/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actions: [{ id: action.id, args: { due_date: "whenever" } }] }),
    });
    const body = (await patched.json()) as { plan: Plan; valid: boolean };
    expect(body.valid).toBe(false);
    const patchedAction = body.plan.actions.find((a) => a.id === action.id)!;
    expect(patchedAction.status).toBe("invalid");
    expect(patchedAction.apply).toBe(false);
  });

  it("records every executed action in the activity feed", async () => {
    const plan = await propose();
    await fetch(`${ctx.baseUrl}/api/plans/${plan.id}/approve`, { method: "POST" });
    const response = await fetch(`${ctx.baseUrl}/api/activity?limit=100`);
    const body = (await response.json()) as {
      activity: Array<{ kind: string; tool: string | null; origin: string; detail: { planId?: string } | null }>;
    };
    const planEntries = body.activity.filter((entry) => entry.detail?.planId === plan.id);
    expect(planEntries.length).toBeGreaterThan(0);
    expect(planEntries.some((entry) => entry.origin === "plan-executor")).toBe(true);
  });
});
