import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ToolError, toolDefs, type ToolContext } from "./tooldefs.js";
import { NotFoundError, type Store } from "../services/store.js";
import type { Planner } from "../services/planner.js";

export const SERVER_INFO = { name: "homepilot-ai", version: "1.0.0" } as const;
export const PROTOCOL_VERSION = "2025-06-18";

export interface McpServerOptions {
  store: Store;
  getPlanner: () => Planner;
  /** Called for every successful or failed tools/call, for the activity feed. */
  onToolCall?: (entry: {
    tool: string;
    ok: boolean;
    summary: string;
    detail: unknown;
  }) => void;
}

/**
 * Build a real MCP server with every HomePilot tool registered.
 *
 * The transport is stateless (`sessionIdGenerator: undefined`), so each POST to
 * /mcp gets a freshly built server+transport pair. Our tools are thin wrappers
 * over the shared PostgreSQL store, so no server-side session state is needed and
 * several browser tabs can talk to the endpoint concurrently.
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO);
  const ctx: ToolContext = { store: options.store, getPlanner: options.getPlanner };

  for (const def of toolDefs) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        try {
          const payload = await def.run(args ?? {}, ctx);
          options.onToolCall?.({
            tool: def.name,
            ok: true,
            summary: summarizePayload(def.name, payload),
            detail: { args, result: payload, durationMs: Date.now() - startedAt },
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          };
        } catch (error) {
          const message =
            error instanceof ToolError || error instanceof NotFoundError
              ? error.message
              : `Unexpected error in ${def.name}: ${(error as Error).message}`;
          options.onToolCall?.({
            tool: def.name,
            ok: false,
            summary: message,
            detail: { args, error: message, durationMs: Date.now() - startedAt },
          });
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

function summarizePayload(tool: string, payload: unknown): string {
  const p = payload as Record<string, unknown> | undefined;
  const message = p && typeof p.message === "string" ? p.message : null;
  if (message) return message;
  if (p && typeof p.count === "number") return `${tool} → ${p.count} record(s)`;
  return `${tool} completed`;
}

export interface McpHttpHandlerOptions extends McpServerOptions {
  /** Extra CORS origins allowed on top of the SDK's localhost defaults. */
  allowedOrigins: string[];
}

/**
 * Handle POST/GET/DELETE on the MCP endpoint using the stateless pattern from
 * the official `simpleStatelessStreamableHttp` example: a new server + transport
 * per request, no session tracking.
 */
export function createMcpRequestHandler(options: McpHttpHandlerOptions) {
  return async (req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void> => {
    if (req.method === "DELETE") {
      // Stateless sessions are not tracked, so there is nothing to terminate.
      res.writeHead(405, {
        "content-type": "application/json",
        allow: "POST, GET",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session termination is not supported: this server is stateless." },
          id: null,
        }),
      );
      return;
    }

    const server = createMcpServer(options);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  };
}
