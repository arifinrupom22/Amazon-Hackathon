import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { startTestServer, type TestServer } from "./helpers.js";

/**
 * Protocol-level tests using raw JSON-RPC over fetch, so the wire format of the
 * Streamable HTTP transport is verified independently of the SDK client.
 */
describe.skipIf(!process.env.DATABASE_URL)("JSON-RPC protocol behaviour", () => {
  let ctx: TestServer;

  const rpc = async (
    body: unknown,
    headers: Record<string, string> = {},
    method = "POST",
  ): Promise<{ status: number; json: unknown; text: string }> => {
    const response = await fetch(`${ctx.baseUrl}/mcp`, {
      method,
      headers: {
        "content-type": "application/json",
        // The Streamable HTTP spec requires clients to advertise both media types.
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it("answers initialize with a protocol version and server info", async () => {
    const { status, json } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw-test", version: "0.0.1" },
      },
    });
    expect(status).toBe(200);
    const result = (json as { result: { protocolVersion: string; serverInfo: { name: string } } }).result;
    expect(result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.serverInfo.name).toBe("homepilot-ai");
  });

  it("returns tools/list with JSON Schema for arguments", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const result = (json as { result: { tools: Array<{ name: string; inputSchema: { type: string } }> } }).result;
    expect(result.tools.length).toBe(21);
    expect(result.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  });

  it("executes tools/call and returns the result as text content", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_grocery_items", arguments: { include_purchased: true } },
    });
    const message = json as { result: { content: Array<{ type: string; text: string }> } };
    expect(message.result.content[0].type).toBe("text");
    const payload = JSON.parse(message.result.content[0].text) as { count: number };
    expect(payload.count).toBeGreaterThan(0);
  });

  it("reports unknown methods with JSON-RPC error -32601", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/explode", params: {} });
    const message = json as { error: { code: number; message: string } };
    expect(message.error.code).toBe(-32601);
    expect(message.error.message).toMatch(/not found|unknown/i);
  });

  it("rejects invalid tool arguments without taking down the server", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "create_schedule_event", arguments: { title: "", date: "not-a-date" } },
    });
    const message = json as { result?: { isError?: boolean }; error?: { code: number } };
    const isError = message.result?.isError === true || typeof message.error?.code === "number";
    expect(isError).toBe(true);

    const stillAlive = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} });
    expect((stillAlive.json as { result: { tools: unknown[] } }).result.tools.length).toBe(21);
  });

  it("answers malformed JSON with an error rather than crashing", async () => {
    const response = await fetch(`${ctx.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not json",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const health = await fetch(`${ctx.baseUrl}/healthz`);
    expect(health.status).toBe(200);
  });

  it("rejects requests from disallowed origins (DNS rebinding protection)", async () => {
    const response = await fetch(`${ctx.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects requests without the required Accept header", async () => {
    const response = await fetch(`${ctx.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(406);
  });

  it("rejects unknown Host headers", async () => {
    const { port } = new URL(ctx.baseUrl);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: Number(port),
          path: "/mcp",
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            host: "attacker.example.com",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list", params: {} }));
    });
    expect(status).toBe(403);
  });

  it("refuses session termination because the transport is stateless", async () => {
    const { status, json } = await rpc({}, {}, "DELETE");
    expect(status).toBe(405);
    expect((json as { error: { code: number } }).error.code).toBe(-32000);
  });
});
