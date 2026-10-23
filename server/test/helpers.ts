import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/http/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { closeDatabase, openDatabase, resetSampleData, type Db } from "../src/db/db.js";
import { dropSchema } from "../src/db/postgres.js";

export interface TestServer {
  baseUrl: string;
  db: Db;
  config: AppConfig;
  server: Server;
  close(): Promise<void>;
}

/** Boot the real Express app (REST + MCP endpoint) on an ephemeral port. */
export async function startTestServer(
  env: Record<string, string> = {},
  options: { seed?: boolean } = {},
): Promise<TestServer> {
  const config = loadConfig({
    PORT: "0",
    HOST: "127.0.0.1",
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    AI_PROVIDER: "demo",
    ...env,
  } as NodeJS.ProcessEnv);

  if (!config.databaseUrl) throw new Error("Set DATABASE_URL to a disposable PostgreSQL test database.");
  const schema = `hp_test_${randomUUID().replace(/-/g, "")}`;
  const db = await openDatabase({ databaseUrl: config.databaseUrl, schema });
  if (options.seed !== false) await resetSampleData(db);

  const app = createApp(db, config);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    config,
    server,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDatabase(db);
      await dropSchema(config.databaseUrl, schema);
    },
  };
}

/** An official MCP client connected to the running server over Streamable HTTP. */
export async function connectMcpClient(baseUrl: string): Promise<Client> {
  const client = new Client(
    { name: "homepilot-test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  return client;
}

export function parseToolResult(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((item) => item.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}
