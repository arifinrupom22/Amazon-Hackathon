import { describe, expect, it, vi } from "vitest";
import {
  classifyAssistantCommand,
  executeAssistantCommand,
  type AssistantCommandDeps,
} from "./commands.js";
import type { GroceryItem, Plan } from "../types.js";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan_1",
    title: "Saturday reset",
    requestText: "Plan Saturday",
    summary: "Groceries and cleaning.",
    assumptions: [],
    clarification: null,
    warnings: [],
    actions: [],
    status: "proposed",
    provider: "google",
    providerMode: "live",
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    ...overrides,
  };
}

function grocery(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: "g1",
    name: "Oat milk",
    quantity: 2,
    unit: "cartons",
    category: "Dairy",
    notes: null,
    purchased: false,
    source: "user",
    planId: null,
    createdAt: "2026-10-23T00:00:00.000Z",
    purchasedAt: null,
    ...overrides,
  };
}

type ToolImpl = (name: string, args?: Record<string, unknown>) => Promise<unknown>;

function deps(impl: ToolImpl, plans: Plan[] = []): AssistantCommandDeps {
  return {
    runTool: vi.fn(impl) as unknown as AssistantCommandDeps["runTool"],
    plans,
    cancelPlan: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
  };
}

describe("command classification", () => {
  it("recognizes read-only questions", () => {
    expect(classifyAssistantCommand("What do I need to do today?")).toEqual({ kind: "today" });
    expect(classifyAssistantCommand("What's on my schedule?")).toEqual({ kind: "schedule" });
    expect(classifyAssistantCommand("What do I need to buy?")).toEqual({ kind: "groceries" });
    expect(classifyAssistantCommand("What did you change?")).toEqual({ kind: "changes" });
    expect(classifyAssistantCommand("Check for schedule conflicts")).toEqual({ kind: "conflicts" });
  });

  it("recognizes reversible commands", () => {
    expect(classifyAssistantCommand("Cancel that last proposed change")).toEqual({ kind: "cancel_last_plan" });
    expect(classifyAssistantCommand("I already bought milk.")).toEqual({
      kind: "mark_purchased",
      itemName: "milk",
    });
    expect(classifyAssistantCommand("Mark oat milk as purchased")).toEqual({
      kind: "mark_purchased",
      itemName: "oat milk",
    });
  });

  it("leaves planning requests on the plan workflow", () => {
    expect(
      classifyAssistantCommand(
        "Plan a relaxed Saturday for two. Add groceries for dinner and schedule cleaning in the afternoon.",
      ),
    ).toEqual({ kind: "none" });
    expect(classifyAssistantCommand("Add oat milk and lemons to the grocery list.")).toEqual({ kind: "none" });
    expect(classifyAssistantCommand("Remind me tomorrow at 8 AM to submit my assignment")).toEqual({ kind: "none" });
    expect(classifyAssistantCommand("Move my study session to 7 PM")).toEqual({ kind: "none" });
  });
});

describe("command execution", () => {
  it("answers today's briefing from the real summary tool", async () => {
    const runTool = vi.fn(async () => ({
      counts: { openTasks: 3, groceriesToBuy: 2 },
      today: {
        tasks: [{ title: "Refill inhaler" }, { title: "Water plants" }],
        events: [{ title: "Dinner", date: "2026-10-23", startTime: "19:00" }],
      },
    }));
    const result = await executeAssistantCommand({ kind: "today" }, deps(runTool));
    expect(runTool).toHaveBeenCalledWith("get_household_summary");
    expect(result?.text).toContain("3 open tasks");
    expect(result?.text).toContain("Refill inhaler");
    expect(result?.mutated).toBe(false);
  });

  it("answers the grocery question through list_grocery_items", async () => {
    const runTool = vi.fn(async () => ({ items: [grocery(), grocery({ id: "g2", name: "Lemons", quantity: 1 })] }));
    const result = await executeAssistantCommand({ kind: "groceries" }, deps(runTool));
    expect(runTool).toHaveBeenCalledWith("list_grocery_items", { include_purchased: false });
    expect(result?.text).toContain("2 items");
    expect(result?.text).toContain("Oat milk");
  });

  it("marks exactly one matching item purchased through MCP and refreshes", async () => {
    const ctx = deps(
      vi.fn(async (name: string) =>
        name === "list_grocery_items" ? { items: [grocery()] } : { item: grocery({ purchased: true }) },
      ),
    );
    const result = await executeAssistantCommand(
      { kind: "mark_purchased", itemName: "oat milk" },
      ctx,
    );
    expect(ctx.runTool).toHaveBeenCalledWith("mark_grocery_item_purchased", { id: "g1", purchased: true });
    expect(ctx.refresh).toHaveBeenCalled();
    expect(result?.text).toContain("Marked “Oat milk” as purchased");
    expect(result?.mutated).toBe(true);
  });

  it("asks which item to mark when several match", async () => {
    const ctx = deps(
      vi.fn(async () => ({
        items: [grocery({ name: "Oat milk" }), grocery({ id: "g2", name: "Oat crackers" })],
      })),
    );
    const result = await executeAssistantCommand({ kind: "mark_purchased", itemName: "oat" }, ctx);
    expect(result?.text).toContain("more than one match");
    expect(ctx.runTool).not.toHaveBeenCalledWith("mark_grocery_item_purchased", expect.anything());
  });

  it("does not mutate an item that is already purchased", async () => {
    const ctx = deps(vi.fn(async () => ({ items: [grocery({ purchased: true })] })));
    const result = await executeAssistantCommand({ kind: "mark_purchased", itemName: "oat milk" }, ctx);
    expect(result?.text).toContain("already marked");
    expect(ctx.refresh).not.toHaveBeenCalled();
  });

  it("cancels the newest open plan without touching data", async () => {
    const ctx = deps(vi.fn(), [plan({ status: "cancelled" }), plan({ id: "plan_2", title: "Weekend" })]);
    const result = await executeAssistantCommand({ kind: "cancel_last_plan" }, ctx);
    expect(ctx.cancelPlan).toHaveBeenCalledWith("plan_2");
    expect(result?.text).toContain("Nothing was changed");
    expect(result?.mutated).toBe(true);
  });

  it("filters audit noise out of 'what changed'", async () => {
    const ctx = deps(
      vi.fn(async () => ({
        entries: [
          { kind: "mcp_tool", origin: "mcp-client", summary: "list_tasks → 4 records" },
          { kind: "plan", origin: "server", summary: "Plan applied — 2 actions" },
          { kind: "mcp_tool", origin: "plan-executor", summary: "Added oat milk." },
        ],
      })),
    );
    const result = await executeAssistantCommand({ kind: "changes" }, ctx);
    expect(result?.text).toContain("Plan applied");
    expect(result?.text).toContain("Added oat milk");
    expect(result?.text).not.toContain("list_tasks");
  });

  it("returns null for a non-command so the assistant can plan", async () => {
    expect(await executeAssistantCommand({ kind: "none" }, deps(vi.fn()))).toBeNull();
  });
});
