import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { PROTOCOL_VERSION, SERVER_INFO, createMcpRequestHandler } from "../mcp/server.js";
import { toolDefs } from "../mcp/tooldefs.js";
import { createProvider } from "../services/ai/index.js";
import { Planner } from "../services/planner.js";
import {
  GoogleTranscriptionService,
  TranscriptionError,
  normalizeAudioType,
  type TranscriptionLanguage,
} from "../services/transcription.js";
import { Store } from "../services/store.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/db.js";
import { reseed } from "../db/db.js";

export interface AppServices {
  store: Store;
  planner: Planner;
  config: AppConfig;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function parseTranscriptionLanguage(value: unknown): TranscriptionLanguage {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "en-US" || raw === "bn-BD" || raw === "auto") return raw;
  return "auto";
}

export function createApp(db: Db, config: AppConfig): express.Express {
  const store = new Store(db);
  const planner = new Planner(store, createProvider(config));
  const transcription = new GoogleTranscriptionService(config.transcription);
  const services: AppServices = { store, planner, config };

  const app = express();
  app.disable("x-powered-by");

  /* --------------------------- security middleware ------------------------- */

  const allowedOrigins = new Set(config.corsOrigins);
  // DNS-rebinding protection: only loopback hostnames may address this server.
  const allowedHostnames = new Set(
    [config.host, "localhost", "127.0.0.1", "::1", "[::1]"].map((host) => host.toLowerCase()),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (host) {
      const hostname = host.startsWith("[")
        ? host.slice(0, host.indexOf("]") + 1)
        : (host.split(":")[0] ?? host);
      if (!allowedHostnames.has(hostname)) {
        res.status(403).json({ error: `Host header "${host}" is not allowed (DNS rebinding protection).` });
        return;
      }
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).json({ error: `Origin "${origin}" is not allowed.` });
      return;
    }
    next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header = same-origin or a non-browser client (curl, tests).
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(null, false);
      },
      exposedHeaders: ["Mcp-Session-Id", "MCP-Protocol-Version"],
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  // Small in-memory rate limiter — plenty for a local demo, blocks runaway loops.
  // It runs before body parsing so oversized or repeated uploads are refused early.
  const hits = new Map<string, { count: number; resetAt: number }>();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    entry.count += 1;
    if (entry.count > 1200) {
      res.status(429).json({ error: "Too many requests — slow down." });
      return;
    }
    next();
  });

  /* ---------------------------- transcription ----------------------------- */

  app.post(
    "/api/transcribe",
    express.raw({ type: ["audio/*", "application/octet-stream"], limit: "8mb" }),
    async (req: Request, res: Response) => {
      const info = transcription.info();
      const language = parseTranscriptionLanguage(req.query.language ?? req.headers["x-audio-language"]);
      const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const mimeType = normalizeAudioType(req.headers["content-type"]);

      if (!info.available) {
        res.status(503).json({
          error: info.detail,
          code: "transcription_unavailable",
          model: info.model,
        });
        return;
      }
      if (!mimeType) {
        res.status(415).json({
          error: "Send a short audio recording as audio/webm, audio/ogg, audio/mp4 or audio/wav.",
          code: "unsupported_audio_type",
        });
        return;
      }
      if (audio.length === 0) {
        res.status(400).json({ error: "The recording was empty. Try again and speak after the microphone opens.", code: "empty_audio" });
        return;
      }
      if (audio.length > config.transcription.maxBytes) {
        res.status(413).json({
          error: "The recording is too large. Keep it under 30 seconds or type the request.",
          code: "audio_too_large",
        });
        return;
      }

      const startedAt = Date.now();
      try {
        const result = await transcription.transcribe({ audio, mimeType, language });
        await store.logActivity({
          kind: "system",
          tool: "transcribe_audio",
          summary: `Transcribed ${Math.round(audio.length / 1024)} KB of audio (${result.text.length} characters)`,
          detail: {
            bytes: audio.length,
            mimeType,
            language: result.language,
            model: result.model,
            latencyMs: result.latencyMs,
          },
          status: "ok",
          origin: "server",
        });
        res.json({
          text: result.text,
          provider: "google",
          model: result.model,
          language: result.language,
          latencyMs: result.latencyMs,
        });
      } catch (error) {
        const failure =
          error instanceof TranscriptionError
            ? error
            : new TranscriptionError("Transcription failed. Try again or type the request.", "upstream");
        await store.logActivity({
          kind: "system",
          tool: "transcribe_audio",
          summary: `Transcription failed (${failure.code})`,
          detail: { bytes: audio.length, mimeType, language, model: info.model, latencyMs: Date.now() - startedAt },
          status: "error",
          origin: "server",
        });
        const status =
          failure.code === "auth"
            ? 502
            : failure.code === "quota"
              ? 429
              : failure.code === "rate_limit"
                ? 429
                : failure.code === "invalid_audio" || failure.code === "no_speech"
                  ? 422
                  : failure.code === "network"
                    ? 504
                    : 502;
        res.status(status).json({ error: failure.message, code: failure.code });
      }
    },
  );

  app.use(express.json({ limit: "256kb" }));

  /* ------------------------------ MCP endpoint ----------------------------- */

  const mcpHandler = createMcpRequestHandler({
    store,
    getPlanner: () => planner,
    allowedOrigins: config.corsOrigins,
    onToolCall(entry) {
      // Fire-and-forget: the MCP handler invokes this synchronously and must not
      // block on the write. A failure here is logged, never thrown.
      void store
        .logActivity({
          kind: "mcp_tool",
          tool: entry.tool,
          summary: entry.summary,
          detail: entry.detail,
          status: entry.ok ? "ok" : "error",
          origin: "mcp-client",
        })
        .catch((error: Error) => console.error("activity log failed:", error.message));
    },
  });

  const mcp = (req: Request, res: Response) => {
    void mcpHandler(req, res, req.body).catch((error: Error) => {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: `Internal server error: ${error.message}` },
          id: null,
        });
      }
    });
  };

  app.post("/mcp", mcp);
  app.get("/mcp", mcp);
  app.delete("/mcp", mcp);

  /* --------------------------------- REST ---------------------------------- */

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: SERVER_INFO.name,
      version: SERVER_INFO.version,
      mcpEndpoint: "/mcp",
      protocolVersion: PROTOCOL_VERSION,
      toolCount: toolDefs.length,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/api/status", async (_req, res) => {
    const provider = planner.providerInfo();
    const health = await planner.health();
    res.json({
      service: SERVER_INFO,
      protocolVersion: PROTOCOL_VERSION,
      mcpEndpoint: "/mcp",
      tools: toolDefs.map((def) => ({ name: def.name, domain: def.domain, description: def.description })),
      provider,
      providerHealth: health,
      transcription: transcription.info(),
      counts: await store.summary(),
      household: await store.getHousehold(),
    });
  });

  /**
   * Controlled quota test. The next plan request is answered as if the provider
   * returned 429 RESOURCE_EXHAUSTED: no network call, no real credits used.
   */
  app.post("/api/provider/simulate-quota", (_req, res) => {
    planner.simulateQuotaExhausted();
    res.json({
      ok: true,
      message:
        "The next plan request will receive a simulated quota-exhausted response. No provider call is made and no credits are consumed.",
    });
  });

  app.get("/api/activity", async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    res.json({ activity: await store.listActivity(limit) });
  });

  app.get("/api/prompts", (_req, res) => {
    res.json({
      prompts: [
        "Plan a relaxed Saturday for two. Add grocery items for dinner, schedule a cleaning session in the afternoon, and remind me to prepare dinner before 7 PM.",
        "Plan our weekend. We need groceries for two people, a cleaning session on Saturday, and a reminder to prepare dinner before 7 PM.",
        "We have guests on Saturday at 7 PM. We're out of rice, the living room needs cleaning, and Marcus can't help until 6 PM.",
        "Add a task to water the plants tomorrow morning and remind me before 8 AM.",
        "Pick up Leo from soccer today at 5 PM and add oat milk, lemons and sourdough bread to the grocery list.",
      ],
    });
  });

  /* ------------------------------ plans API -------------------------------- */

  app.get("/api/plans", async (_req, res) => {
    res.json({ plans: await store.listPlans(20) });
  });

  app.get("/api/plans/:id", async (req, res) => {
    const plan = await store.getPlan(req.params.id);
    if (!plan) {
      res.status(404).json({ error: `Plan ${req.params.id} not found.` });
      return;
    }
    res.json({ plan });
  });

  app.post("/api/plans", async (req, res) => {
    const body = (req.body ?? {}) as { request?: unknown; reference_date?: unknown };
    const request = typeof body.request === "string" ? body.request.trim() : "";
    const referenceDate =
      typeof body.reference_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.reference_date)
        ? body.reference_date
        : undefined;
    if (request.length < 5) {
      res.status(400).json({ error: "Provide a request string of at least 5 characters." });
      return;
    }
    if (request.length > 2000) {
      res.status(400).json({ error: "Request is limited to 2000 characters." });
      return;
    }
    try {
      const result = await planner.propose({ request, referenceDate });
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.patch("/api/plans/:id", async (req, res) => {
    const body = (req.body ?? {}) as {
      title?: unknown;
      actions?: Array<{ id?: unknown; apply?: unknown; label?: unknown; args?: unknown }>;
    };
    try {
      let plan = await store.getPlan(req.params.id);
      if (!plan) {
        res.status(404).json({ error: `Plan ${req.params.id} not found.` });
        return;
      }
      if (plan.status === "applied" || plan.status === "partially_applied") {
        res.status(409).json({ error: "This plan has already been applied and can no longer be edited." });
        return;
      }
      if (typeof body.title === "string" && body.title.trim().length >= 2) {
        plan = await store.updatePlan(plan.id, { title: body.title.trim() });
      }
      for (const update of body.actions ?? []) {
        if (typeof update.id !== "string") continue;
        plan = await planner.updateAction(plan.id, update.id, {
          apply: typeof update.apply === "boolean" ? update.apply : undefined,
          label: typeof update.label === "string" ? update.label : undefined,
          args: update.args && typeof update.args === "object" ? (update.args as Record<string, unknown>) : undefined,
        });
      }
      const validation = await planner.validate(plan.id);
      res.json({ plan: validation.plan, warnings: validation.warnings, valid: validation.valid });
    } catch (error) {
      const message = (error as Error).message;
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  app.post("/api/plans/:id/approve", async (req, res) => {
    try {
      const result = await planner.approve(req.params.id);
      res.json(result);
    } catch (error) {
      const message = (error as Error).message;
      res.status(message.includes("not found") ? 404 : 409).json({ error: message });
    }
  });

  app.post("/api/plans/:id/cancel", async (req, res) => {
    try {
      const plan = await planner.cancel(req.params.id);
      res.json({ plan });
    } catch (error) {
      const message = (error as Error).message;
      res.status(message.includes("not found") ? 404 : 409).json({ error: message });
    }
  });

  /* -------------------------------- demo API ------------------------------- */

  app.post("/api/demo/reset", async (_req, res) => {
    await reseed(db);
    res.json({
      ok: true,
      message: "Sample household data restored. All plans, tasks, events, groceries and activity were reset.",
      counts: await store.summary(),
    });
  });

  /* --------------------------- static web build ---------------------------- */

  const webDist = path.resolve(here, "../../../web/dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    app.use(express.static(webDist));
    // Express 5 / path-to-regexp v8: a bare "*" is invalid, so use a regex fallback.
    app.get(/^\/(?!api|mcp|healthz).*/, (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/mcp")) return next();
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: `No route for ${req.method} ${req.path}. The MCP endpoint lives at POST /mcp.`,
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const type = (err as Error & { type?: string }).type;
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    if (type === "entity.too.large") {
      res.status(413).json({ error: "That upload is too large. Keep recordings under 30 seconds." });
      return;
    }
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}
