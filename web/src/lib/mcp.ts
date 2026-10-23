import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TraceEntry } from "./types";

/**
 * The web app is a genuine MCP client.
 *
 * It uses the official TypeScript SDK (`Client` + `StreamableHTTPClientTransport`)
 * to speak JSON-RPC to the HomePilot MCP server at /mcp: `initialize` during
 * connect(), `tools/list` to discover tools, and `tools/call` to read and change
 * real household data. Nothing here is simulated.
 */

const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
export const MCP_ENDPOINT = `${API_BASE}/mcp`;

/** Streamable HTTP requires an absolute URL, so resolve against the page origin. */
function endpointUrl(): URL {
  return new URL(MCP_ENDPOINT, window.location.origin);
}

let clientPromise: Promise<Client> | null = null;
let client: Client | null = null;
let serverInfo: { name?: string; version?: string } | null = null;
let negotiatedProtocol: string | null = null;

type TraceListener = (entry: TraceEntry) => void;
const traceListeners = new Set<TraceListener>();
const traceHistory: TraceEntry[] = [];
let traceSeq = 0;

export function subscribeTrace(listener: TraceListener): () => void {
  traceListeners.add(listener);
  return () => traceListeners.delete(listener);
}

export function getTraceHistory(): TraceEntry[] {
  return [...traceHistory];
}

function record(entry: Omit<TraceEntry, "id" | "ts">): void {
  const full: TraceEntry = { id: `tr_${++traceSeq}`, ts: Date.now(), ...entry };
  traceHistory.unshift(full);
  if (traceHistory.length > 120) traceHistory.pop();
  for (const listener of traceListeners) listener(full);
}

export function getMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const c = new Client(
        { name: "homepilot-web", version: "1.0.0" },
        { capabilities: {} },
      );
      const startedAt = performance.now();
      const transport = new StreamableHTTPClientTransport(endpointUrl());
      await c.connect(transport);
      client = c;
      serverInfo = c.getServerVersion() ?? null;
      // The SDK transport records the version negotiated in the initialize response.
      negotiatedProtocol = (c.transport as unknown as { protocolVersion?: string } | undefined)?.protocolVersion ?? null;
      record({
        method: "initialize",
        ok: true,
        durationMs: Math.round(performance.now() - startedAt),
        summary: `initialize → ${serverInfo?.name ?? "server"} v${serverInfo?.version ?? "?"}${negotiatedProtocol ? ` (protocol ${negotiatedProtocol})` : ""}`,
        isError: false,
      });
      return c;
    })().catch((error: Error) => {
      clientPromise = null;
      record({
        method: "initialize",
        ok: false,
        durationMs: 0,
        summary: `initialize failed: ${error.message}`,
        isError: true,
      });
      throw error;
    });
  }
  return clientPromise;
}

export function getServerInfo(): { name?: string; version?: string } | null {
  return serverInfo;
}

/** The MCP protocol version negotiated during initialize, when the SDK exposes it. */
export function getProtocolVersion(): string | null {
  return negotiatedProtocol;
}

/** True when the browser has a live, initialized MCP session. */
export function isMcpConnected(): boolean {
  return client !== null;
}

export async function listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
  const c = await getMcpClient();
  const startedAt = performance.now();
  const result = await c.listTools();
  record({
    method: "tools/list",
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    summary: `tools/list → ${result.tools.length} tools`,
    isError: false,
  });
  return result.tools;
}

/**
 * Call a tool on the MCP server and parse its structured text payload.
 * Every call is recorded in the on-screen MCP trace.
 */
export async function callTool<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const c = await getMcpClient();
  const startedAt = performance.now();
  try {
    const result = await c.callTool({ name, arguments: args });
    const durationMs = Math.round(performance.now() - startedAt);
    const content = (result.content as Array<{ type: string; text?: string }> | undefined) ?? [];
    const text = content.find((item) => item.type === "text")?.text ?? "{}";
    const isError = result.isError === true;

    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { text };
    }

    record({
      method: "tools/call",
      tool: name,
      args,
      ok: !isError,
      durationMs,
      summary: isError ? `${name} → error: ${text.slice(0, 140)}` : summarize(name, payload, text),
      isError,
    });

    if (isError) {
      throw new McpToolError(name, text);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    const durationMs = Math.round(performance.now() - startedAt);
    record({
      method: "tools/call",
      tool: name,
      args,
      ok: false,
      durationMs,
      summary: `${name} → ${(error as Error).message}`,
      isError: true,
    });
    throw error;
  }
}

export class McpToolError extends Error {
  constructor(
    public readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

function summarize(tool: string, payload: unknown, fallback: string): string {
  const p = payload as Record<string, unknown> | null;
  if (p && typeof p.message === "string") return `${tool} → ${p.message}`;
  if (p && typeof p.count === "number") return `${tool} → ${p.count} record(s)`;
  return `${tool} ok (${fallback.slice(0, 60)})`;
}

/** Reset the client (used after "reset sample data"). */
export async function resetMcpClient(): Promise<void> {
  try {
    await client?.close();
  } catch {
    /* ignore */
  }
  client = null;
  clientPromise = null;
  serverInfo = null;
  negotiatedProtocol = null;
}
