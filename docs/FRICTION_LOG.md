# Build friction log

What actually went wrong while building this, what the cause was, and how it was resolved.
Status: **fixed** = shipped workaround/fix in this repository, **documented** = limitation accepted
and written down, **tooling** = environment issue outside the product.

| # | Area | Symptom | Cause | Resolution | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | MCP transport | Every `curl` to `/mcp` returned `406 Not Acceptable` | Streamable HTTP requires `Accept: application/json, text/event-stream` | Added the header to all documented curl examples; tests send it too | Fixed |
| 2 | MCP server | SDK threw "Server not initialized" on `tools/call` | A single transport instance was reused across stateless requests | New `McpServer` + transport per request, `sessionIdGenerator: undefined`, `enableJsonResponse: true` | Fixed |
| 3 | Express 5 | `app.get("*")` crashed at boot with a path-to-regexp error | Express 5 / path-to-regexp v8 removed bare `*` routes | Replaced with a regex SPA fallback | Fixed |
| 4 | Browser client | MCP client failed with "Invalid URL" | Relative `/mcp` passed to `StreamableHTTPClientTransport` | Build an absolute URL from `window.location.origin` | Fixed |
| 5 | Planning | Server "today" differed from the UI's "today" after 18:00 | Server used `toISOString().slice(0,10)` (UTC); UI used local time | Added `server/src/domain/dates.ts` and replaced all date-key generation | Fixed |
| 6 | Tool execution | Plan actions created records with no `planId` | Provenance was stamped outside the tool call | Planner injects `plan_id` into create actions; tools persist it | Fixed |
| 7 | Provider | A 429 was shown as "model failed" with no explanation | No error classification layer | Added `errors.ts`: quota / rate_limit / auth / not_found / network / invalid_output | Fixed |
| 8 | Requirements | "Gemma 4B" had no matching hosted model id | Gemma 4 is E2B/E4B/12B/31B/26B-A4B; AI Studio hosts 26B-A4B and 31B | Defaulted to the 4B-active `gemma-4-26b-a4b-it`, made it configurable, documented the mapping | Documented |
| 9 | Gemini API | Adapter failed on endpoints that reject `generationConfig` | Some deployments return `400 Unknown name "responseMimeType"` | One retry without `generationConfig`, then classify the error | Fixed |
| 10 | Config | Server listened on a random port | Sandbox exported `PORT=0`; config honoured it | Treat `0`/invalid as the documented default `8787` | Fixed |
| 11 | TypeScript | `MessageSquareSpark` was not an export from `lucide-react` | Guessed icon name from memory | Switched to `MessageSquareShare`; verified against installed types | Fixed |
| 12 | TypeScript | Unused `AlertTriangle` import broke `tsc -b` | `noUnusedLocals` is on | Removed the import rather than disabling the check | Fixed |
| 13 | Persistence | Native SQLite packages would need a compiler on Windows | `better-sqlite3` build toolchain absent | Used Node 22.5+ built-in `node:sqlite`; no native step | Fixed |
| 14 | UI | A permanent "Demo mode" badge made the app look like a mock | Early honesty implementation over-corrected | Removed all permanent mode badges; fallback now surfaces as a dismissible, per-response notice | Fixed |
| 15 | Tooling | `Start-Process` with redirection hung the terminal tool for 30–60 s | PowerShell waits on redirected child handles in this environment | Started detached, then verified the listener/HTTP independently | Tooling |
| 16 | Tooling | Playwright `waitUntil: "networkidle"` timed out | Vite HMR keeps a websocket open | Used `domcontentloaded` + explicit text waits | Tooling |
| 17 | Tooling | Preview screenshots intermittently returned "no frames" | Webview compositor did not produce frames after resize | Captured documentation screenshots with headless Chrome instead | Tooling |
| 18 | Testing | `fetch` stubbing intercepted the test server's own HTTP calls | Global stub applied to every URL | Stub passes non-Google URLs through to the captured real `fetch` | Fixed |

## Top three, in detail

### 1. The `Accept` header (cost: every manual test, plus a support note)

`POST /mcp` with a JSON body and `content-type: application/json` returns:

```
406 Not Acceptable
```

The transport negotiates JSON vs SSE through `Accept`, and the spec requires both media types even
when `enableJsonResponse` is on. The fix is one line in every client, but it is the first thing a
judge will try. It is now the first line of the “Testing the MCP server by hand” section and is
repeated in the demo script.

### 2. Stateless HTTP lifecycle (cost: one debugging session, two failing tests)

The SDK types allow `sessionIdGenerator: undefined`, but a long-lived `McpServer` still expects an
initialization handshake before `tools/call`. Reusing one instance across requests produced:

```
Error: Server not initialized
```

The working pattern is: create server + transport per request, connect them, `handleRequest`, and let
the response end with the request. That is now isolated in `server/src/mcp/server.ts` so the route
handler stays trivial.

### 3. Timezone drift between server and client (cost: subtle, would have broken a demo at night)

The API computed “today” in UTC, the React app in local time. Between 18:00 and midnight in
UTC+6 the two disagreed: the server's “today's tasks” were tomorrow's, and `list_schedule` returned
an empty day. All server date keys now go through `toDateKey()` in `server/src/domain/dates.ts`,
which uses local time, and a regression test pins the behaviour.

## What we deliberately did not fix

- **Real Alexa+ integration** — no public API surface to verify against; claiming it would be false.
- **Authentication** — out of scope for a localhost demo; documented as the first production task.
- **MCP elicitation** — the SDK supports it, but the stateless client here does not open a
  server→client channel, so clarification stays a normal field in the plan.
- **Screenshot automation inside the app preview** — replaced with a headless-browser script in
  `.freebuff/screenshot.mjs` (not part of the shipped app).
