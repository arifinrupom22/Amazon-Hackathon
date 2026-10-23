import fs from "node:fs";
import path from "node:path";
import { createApp } from "./http/app.js";
import { loadConfig } from "./config.js";
import { closeDatabase, isDatabaseEmpty, openDatabase, resetSampleData } from "./db/db.js";
import { toolDefs } from "./mcp/tooldefs.js";

/** Minimal .env loader so `npm run dev` works without extra dependencies. */
function loadDotEnv(): void {
  // Workspace scripts run with `server/` as cwd, while the documented .env
  // lives at the repository root. Check both locations so either launch path works.
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function displayUrl(url: string): string {
  // Never print credentials: show only host/database for the startup banner.
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(invalid DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();

  if (!config.databaseUrl) {
    console.error(
      "\n  DATABASE_URL is not set.\n\n" +
        "  HomePilot stores all data in PostgreSQL. Set DATABASE_URL to a connection\n" +
        "  string (Neon, local Postgres, or a Docker container). See README → Database setup.\n\n" +
        "  Example (Neon):  postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require\n" +
        "  Example (local): postgresql://postgres:password@127.0.0.1:5432/homepilot\n",
    );
    process.exit(1);
  }

  // Migrations are applied here; seeding happens only on an empty database (or
  // when SEED_ON_START=true), so existing data is never dropped automatically.
  const db = await openDatabase({ databaseUrl: config.databaseUrl });

  if (config.seedOnStart || (await isDatabaseEmpty(db))) {
    await resetSampleData(db);
  }

  const app = createApp(db, config);

  const server = app.listen(config.port, config.host, () => {
    const base = `http://${config.host}:${config.port}`;
    console.log("");
    console.log("  HomePilot AI server");
    console.log("  ------------------------------");
    console.log(`  API + web     ${base}`);
    console.log(`  MCP endpoint  ${base}/mcp   (Streamable HTTP, stateless)`);
    console.log(`  Health        ${base}/healthz`);
    console.log(`  MCP tools     ${toolDefs.length} registered`);
    console.log(`  Database      ${displayUrl(config.databaseUrl)}`);
    console.log("");
  });

  const shutdown = () => {
    console.log("\nShutting down…");
    server.close(async () => {
      await closeDatabase(db);
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: Error) => {
  console.error(`\n  Failed to start: ${error.message}\n`);
  process.exit(1);
});
