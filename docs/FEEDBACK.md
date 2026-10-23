# Product & API feedback

Written from the actual HomePilot AI build (Node 24, TypeScript, official MCP TypeScript SDK,
Streamable HTTP, Google AI Studio / Gemini API, Ollama, Vite + React). Nothing here is hypothetical:
each point comes from something that cost time or forced a design change.

## What worked well

**The MCP TypeScript SDK is genuinely usable.** `McpServer` + `registerTool` with a Zod raw shape,
then `StreamableHTTPServerTransport` mounted on Express, produced a spec-compliant endpoint in a few
dozen lines. `tools/list` schemas, protocol-version negotiation and tool errors behaved exactly as
documented, and the official client connected from the browser without special handling.

**Stateless Streamable HTTP is the right default for request/response UIs.** `sessionIdGenerator:
undefined` plus `enableJsonResponse: true` means one server instance per request and no session
bookkeeping. For a web app that already has a session concept, this removed an entire class of bugs.

**JSON-RPC errors are predictable.** Unknown method → `-32601`, bad arguments → tool result with
`isError: true`, `DELETE /mcp` → `405` on a stateless transport. Our tests assert the wire format
directly, which was only possible because the behaviour is consistent.

**Gemma 4 via the Gemini API is a good fit for structured extraction.** `responseMimeType:
application/json` plus `systemInstruction` gave parseable JSON from a hosted open model, and the
free tier made a student project viable.

**SQLite through `node:sqlite`.** Zero native builds, zero install friction. For a local-first app
this is a much lower-risk choice than native bindings.

## Pain points, in order of impact

### 1. Streamable HTTP examples assume more state than the spec requires (high)

The transport requires an `Accept` header containing both `application/json` and
`text/event-stream`; a plain `curl -H 'content-type: application/json'` gets `406` with no hint about
the header. Every manual-testing instruction we wrote has to repeat it, and every judge who tries
`curl` will hit it.

**Suggestion:** mention the required `Accept` header in the first Streamable HTTP example, and make
the 406 body name the missing media type.

### 2. "Stateless" is documented as a flag, not as a recipe (medium-high)

`sessionIdGenerator: undefined` is necessary but not sufficient: you also need a fresh
`McpServer`/transport per request if tools close over per-request state, and you must not call
`transport.handleRequest` after the response has ended. The SDK examples we found were either
stateful or skipped the HTTP integration entirely.

**Suggestion:** publish a canonical Express/Fastify stateless example with the request lifecycle
spelled out, including why `enableJsonResponse` matters for simple clients.

### 3. Tool handlers and app code speak different result shapes (medium)

A handler returns `{ content: [{ type: "text", text: JSON.stringify(payload) }] }`. The web app and
the plan executor then parse that text back into JSON. This is fine, but it means every consumer
re-implements a parser, and typed `structuredContent` support is uneven across clients.

**Suggestion:** ship a typed result helper (`jsonResult<T>()`) and document when to use
`structuredContent` versus text content, with a compatibility note.

### 4. Gemini/Gemma error classification is too coarse (medium)

Gemma 4 hosted models return `429 RESOURCE_EXHAUSTED` for both "out of credits" and "too many
requests this minute", sometimes inside a 403. To show the correct message we had to inspect the
response body for words like `quota`, `billing` and `per minute`. That is guesswork against an
unstable surface.

**Suggestion:** distinct machine-readable reasons (or a `details[].reason` enum) for
`QUOTA_EXHAUSTED` vs `RATE_LIMITED` vs `MODEL_NOT_FOUND`, and the same shape on 403. Also: the
Gemma-on-Gemini-API page is marked deprecated in favour of `gemma.ai`, but the API itself still
works — that contradiction is confusing.

### 5. "Gemma 4B" does not map to a hosted model id (medium)

The Gemma 4 family is E2B / E4B / 12B / 31B / 26B-A4B. Google AI Studio exposes only
`gemma-4-26b-a4b-it` and `gemma-4-31b-it`, so a literal 4B requirement cannot be met through the
hosted API. The 26B-A4B model is the 4B-active variant, which we used and documented, but this took
research to establish.

**Suggestion:** a table of "family name → hosted id → active parameters" in the Gemma docs, and an
explicit note when the edge variants are not available through AI Studio.

### 6. Tool naming and `inputSchema` discovery are fine — but descriptions carry all the weight (low-medium)

An agent has only the description to decide when to call `update_task` versus `create_task`. We
rewrote descriptions several times and added refusal rules (duplicates, `confirm: true`), which
improved plan quality more than prompt tweaks did. There is no way to express "this tool is a
read-only summary" beyond prose.

**Suggestion:** consider standard annotations beyond `readOnlyHint` (e.g. cost, idempotency,
requires-confirmation), and surface them in `tools/list` examples.

### 7. Browser MCP clients need explicit absolute URLs and CORS/Origin policy (low)

`new StreamableHTTPClientTransport(new URL("/mcp", window.location.origin))` is not a URL — a
relative path silently fails. We also had to add our own Origin allow-list because the SDK does not
enforce one for you.

**Suggestion:** validate the constructor argument and throw a message that says "use an absolute
URL"; document the Origin-check responsibility for servers.

### 8. Human-in-the-loop has no protocol primitive (low, but conceptually important)

Approval is the core safety feature of this app, and it lives entirely in our application layer:
propose → store → validate → explicit `apply_approved_plan(confirm: true)`. MCP gives us tools, not
transactions or confirmations. That is the right layering, but there is no reference pattern for
"agent proposes, human approves, server executes" with idempotency and provenance.

**Suggestion:** publish a HITL reference implementation alongside the tool examples. It would save
every agent builder from reinventing plan staging badly.

## Smaller notes

- `@modelcontextprotocol/inspector` is excellent for `tools/list`/`tools/call`; connecting it to a
  stateless HTTP endpoint worked first try.
- Express 5's path-to-regexp v8 rejects bare `"*"` routes; the error message is clear, but every
  SPA-fallback snippet online is still Express 4 style.
- Ollama's `format: "json"` is a real productivity win for small models; `gemma3:4b` on a laptop is
  slow but adequate for extraction.
- Node's `node:sqlite` still prints an experimental warning on some releases. It is worth the
  trade-off for a no-native-deps demo, but the warning makes judges ask questions.
- Vite's dev proxy needs both `/api` and `/mcp`; SSE-through-proxy works, but we deliberately chose
  JSON responses to keep the demo deterministic.
- There is no public documentation of how a third-party MCP server would be surfaced inside Alexa+.
  We built the honest self-hosted version instead of claiming an integration we cannot verify.

## What we would build next

1. **Per-user scoping + auth** so the server can be hosted beyond localhost.
2. **A real approval ledger**: append-only audit of every tool call with actor, timestamp and diff.
3. **Elicitation for clarification**: use MCP elicitation instead of a plain text question when the
   client supports it.
4. **Model-agnostic evaluation set**: 50 household requests with expected actions, scored on
   precision/recall, run against every provider on each change.
5. **Streaming plan generation** so the review screen fills in progressively on slow local models.
