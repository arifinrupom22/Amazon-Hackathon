import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/services/ai/index.js";
import { QUOTA_EXHAUSTED_NOTICE, classifyHttpFailure, describeFailure } from "../src/services/ai/errors.js";
import { startTestServer, type TestServer } from "./helpers.js";

const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const realFetch = globalThis.fetch.bind(globalThis);

const planJson = {
  title: "Weekend reset",
  summary: "Stock the kitchen and block Saturday morning for cleaning.",
  assumptions: ["Saturday means the coming Saturday."],
  clarification: null,
  actions: [
    {
      tool: "add_grocery_item",
      args: { name: "Oat milk", quantity: 2, unit: "carton" },
      label: "Oat milk",
      detail: "Dairy aisle",
    },
    {
      tool: "create_task",
      args: { title: "Clean the kitchen", due_date: "2026-10-24" },
      label: "Clean the kitchen",
      detail: "Saturday morning",
    },
  ],
};

function geminiOk(): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(planJson) }] } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function quotaFailure(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "You exceeded your current quota. Please check your plan and billing details.",
      },
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
}

/** Intercept only Google traffic; test-server HTTP calls pass through. */
function stubGemini(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(GEMINI_HOST)) return handler(url, init);
      return realFetch(input as Parameters<typeof realFetch>[0], init);
    }),
  );
}

async function propose(baseUrl: string, request = "Plan our weekend with groceries and cleaning") {
  const response = await realFetch(`${baseUrl}/api/plans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider failure classification", () => {
  it("treats RESOURCE_EXHAUSTED as exhausted credits, not a generic error", () => {
    const error = classifyHttpFailure(429, '{"status":"RESOURCE_EXHAUSTED","message":"quota exceeded"}', "Gemma");
    expect(error.kind).toBe("quota");
    expect(describeFailure(error, "Gemma").message).toBe(QUOTA_EXHAUSTED_NOTICE);
    expect(QUOTA_EXHAUSTED_NOTICE).toBe("API credits exhausted. Demo mode is now active.");
  });

  it("distinguishes a short-term rate limit from exhausted credits", () => {
    const error = classifyHttpFailure(429, '{"message":"rate limit reached, retry later"}', "Gemma");
    expect(error.kind).toBe("rate_limit");
    expect(describeFailure(error, "Gemma").message).toContain("rate limiting");
  });

  it("classifies auth, missing model and upstream failures", () => {
    expect(classifyHttpFailure(401, "API key not valid", "Gemma").kind).toBe("auth");
    expect(classifyHttpFailure(404, "model not found", "Gemma").kind).toBe("not_found");
    expect(classifyHttpFailure(503, "backend unavailable", "Gemma").kind).toBe("network");
  });
});

describe("Google AI Studio provider", () => {
  it("reports a missing key instead of attempting a call", async () => {
    const config = loadConfig({ AI_PROVIDER: "google", GEMINI_API_KEY: "" } as NodeJS.ProcessEnv);
    const provider = createProvider(config);
    const health = await provider.health();
    expect(health.available).toBe(false);
    expect(health.detail).toContain("GEMINI_API_KEY");
    expect(provider.info().name).toBe("google");
    expect(provider.info().model).toBe("gemma-4-26b-a4b-it");
  });

  it("returns a validated plan produced by the model", async () => {
    const calls: string[] = [];
    stubGemini(async (url) => {
      calls.push(url);
      return url.includes(":generateContent") ? geminiOk() : new Response("{}", { status: 200 });
    });

    const ctx: TestServer = await startTestServer({
      AI_PROVIDER: "google",
      GEMINI_API_KEY: "test-key",
    });
    try {
      const { status, body } = await propose(ctx.baseUrl);
      expect(status).toBe(201);
      const plan = body.plan as { provider: string; providerMode: string; actions: Array<{ tool: string }> };
      expect(plan.provider).toBe("google");
      expect(plan.providerMode).toBe("live");
      expect(plan.actions.map((action) => action.tool)).toEqual(["add_grocery_item", "create_task"]);
      expect(body.fallback).toBeUndefined();
      expect(calls.some((url) => url.includes(":generateContent?key=test-key"))).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it("retries without generationConfig when the endpoint rejects it", async () => {
    const posts: string[] = [];
    stubGemini(async (url, init) => {
      if (!url.includes(":generateContent")) return new Response("{}", { status: 200 });
      const payload = String(init?.body ?? "");
      posts.push(payload);
      if (posts.length === 1) {
        return new Response(
          JSON.stringify({
            error: { message: 'Invalid JSON payload received. Unknown name "responseMimeType"', status: "INVALID_ARGUMENT" },
          }),
          { status: 400 },
        );
      }
      return geminiOk();
    });

    const ctx = await startTestServer({ AI_PROVIDER: "google", GEMINI_API_KEY: "test-key" });
    try {
      const { status, body } = await propose(ctx.baseUrl);
      expect(status).toBe(201);
      expect(posts).toHaveLength(2);
      expect(posts[0]).toContain("responseMimeType");
      expect(posts[1]).not.toContain("responseMimeType");
      expect((body.plan as { actions: unknown[] }).actions).toHaveLength(2);
    } finally {
      await ctx.close();
    }
  });

  it("falls back with the exact notice when the key has no credits", async () => {
    stubGemini(async (url) =>
      url.includes(":generateContent") ? quotaFailure() : new Response("{}", { status: 200 }),
    );

    const ctx = await startTestServer({ AI_PROVIDER: "google", GEMINI_API_KEY: "test-key" });
    try {
      const { status, body } = await propose(ctx.baseUrl);
      expect(status).toBe(201);
      const fallback = body.fallback as { notice: string; kind: string; simulated: boolean };
      expect(fallback.kind).toBe("quota");
      expect(fallback.notice).toBe("API credits exhausted. Demo mode is now active.");
      expect(fallback.simulated).toBe(false);
      const plan = body.plan as { providerMode: string; actions: unknown[] };
      expect(plan.providerMode).toBe("demo");
      expect(plan.actions.length).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it("falls back cleanly when the API rejects the key", async () => {
    stubGemini(async () =>
      new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), {
        status: 401,
      }),
    );

    const ctx = await startTestServer({ AI_PROVIDER: "google", GEMINI_API_KEY: "bad-key" });
    try {
      const { status, body } = await propose(ctx.baseUrl);
      expect(status).toBe(201);
      const fallback = body.fallback as { notice: string; kind: string };
      expect(fallback.kind).toBe("auth");
      expect(fallback.notice.toLowerCase()).toContain("unavailable");
      expect((body.plan as { actions: unknown[] }).actions.length).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});

describe("controlled quota test", () => {
  it("injects a quota response without calling a provider", async () => {
    const ctx = await startTestServer({ AI_PROVIDER: "google", GEMINI_API_KEY: "test-key" });
    const spy = vi.fn();
    stubGemini(async () => {
      spy();
      return geminiOk();
    });
    try {
      const arm = await realFetch(`${ctx.baseUrl}/api/provider/simulate-quota`, { method: "POST" });
      expect(arm.status).toBe(200);
      expect(((await arm.json()) as { message: string }).message).toContain("No provider call is made");

      const { status, body } = await propose(ctx.baseUrl);
      expect(status).toBe(201);
      const fallback = body.fallback as { notice: string; kind: string; simulated: boolean };
      expect(fallback.notice).toBe("API credits exhausted. Demo mode is now active.");
      expect(fallback.kind).toBe("quota");
      expect(fallback.simulated).toBe(true);
      expect(spy).not.toHaveBeenCalled();

      // The simulation is one-shot: the next request goes back to the provider.
      const next = await propose(ctx.baseUrl);
      expect(next.body.fallback).toBeUndefined();
      expect(spy).toHaveBeenCalled();
    } finally {
      await ctx.close();
    }
  });
});
