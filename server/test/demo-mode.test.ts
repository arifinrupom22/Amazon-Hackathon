import { describe, expect, it } from "vitest";
import { createProvider } from "../src/services/ai/index.js";
import { loadConfig } from "../src/config.js";
import { DemoProvider, parseRequest } from "../src/services/ai/demo.js";
import type { ProposalInput } from "../src/services/ai/types.js";

/**
 * Demo-mode guarantees: with no model configured (or an unreachable one) the
 * app must still produce a usable, clearly-labelled plan and say so honestly.
 */
describe("Demo mode when no model is available", () => {
  const sampleInput = (): ProposalInput => ({
      request:
        "Plan our weekend. We need groceries for two people, a cleaning session on Saturday, and a reminder to prepare dinner before 7 PM.",
      referenceDate: "2026-10-21",
      household: {
        id: "hh_test", name: "Riverdale Home", members: [],
        preferences: { diet: "", quietHours: "", cleaningDay: "Saturday", shoppingDay: "Saturday", defaultStore: "", notes: "" },
        timezone: "UTC", updatedAt: "2026-10-21T00:00:00.000Z",
      },
      tasks: [], events: [], groceries: [],
    });

  it("the deterministic parser produces the same output for the same request", () => {
    const first = parseRequest(sampleInput());
    const second = parseRequest(sampleInput());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("parses the hackathon example into groceries, a cleaning slot and a reminder", () => {
    const parsed = parseRequest(sampleInput());
    const tools = parsed.actions.map((action) => action.tool);
    expect(tools).toContain("add_grocery_item");
    expect(tools).toContain("create_schedule_event");
    expect(tools).toContain("create_task");
    expect(parsed.actions.length).toBeGreaterThanOrEqual(4);

    const reminder = parsed.actions.find((action) => /prepare dinner/i.test(String(action.args.title)));
    expect(reminder).toBeDefined();
    expect(String(reminder?.args.due_time)).toMatch(/^\d{2}:\d{2}$/);
    // "before 7 PM" -> a 30 minute buffer is applied
    expect(reminder?.args.due_time).toBe("18:30");

    const cleaning = parsed.actions.find((action) => action.tool === "create_schedule_event");
    expect(String(cleaning?.args.date)).toMatch(/^2026-10-2[14]$/); // upcoming Saturday
    expect(parsed.assumptions.length).toBeGreaterThan(0);
  });

  it("labels itself as a local planner with no model and no endpoint", () => {
    const provider = new DemoProvider();
    const info = provider.info();
    expect(info.mode).toBe("demo");
    expect(info.model).toBeNull();
    expect(info.endpoint).toBeNull();
    expect(info.label).toMatch(/local planner/i);
    expect(info.label).toMatch(/no model/i);
  });

  it("proposes offline with AI_PROVIDER=demo", async () => {
    const config = loadConfig({ AI_PROVIDER: "demo" } as NodeJS.ProcessEnv);
    const provider = createProvider(config);
    const output = await provider.propose(sampleInput());
    expect(output.extraction.actions.length).toBeGreaterThan(0);
    expect(output.fallbackReason).toBeUndefined();
  });

  it("falls back to the deterministic parser when Ollama is unreachable, and says so", async () => {
    const config = loadConfig({
      AI_PROVIDER: "ollama",
      OLLAMA_URL: "http://127.0.0.1:59999",
      OLLAMA_MODEL: "gemma3:4b",
    } as NodeJS.ProcessEnv);
    const provider = createProvider(config);
    expect(provider.info().mode).toBe("live");

    const health = await provider.health();
    expect(health.available).toBe(false);

    const output = await provider.propose(sampleInput());
    expect(output.extraction.actions.length).toBeGreaterThan(0);
    expect(output.fallbackReason).toBeTruthy();
    expect(output.fallbackReason).toMatch(/unavailable|Cannot reach|failed/i);
  });

  it("reports a missing API key for the openai-compatible provider without throwing", async () => {
    const config = loadConfig({
      AI_PROVIDER: "openai-compatible",
      OPENAI_API_KEY: "",
    } as NodeJS.ProcessEnv);
    const provider = createProvider(config);
    const output = await provider.propose(sampleInput());
    expect(output.extraction.actions.length).toBeGreaterThan(0);
    expect(output.fallbackReason).toMatch(/OPENAI_API_KEY/);
  });
});
