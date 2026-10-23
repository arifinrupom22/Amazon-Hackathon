# HomePilot AI

**Less household chaos. More time for life.**

HomePilot AI is a household coordination assistant that turns a plain-language request into a
structured, reviewable plan — then executes that plan only after you approve it, through real
**Model Context Protocol (MCP)** tools on a self-hosted **Streamable HTTP** MCP server.

The web app in this repository is a genuine MCP client: it performs MCP `initialize`, `tools/list`
and `tools/call` over JSON-RPC. Every task, event, grocery item and plan you see came from an MCP
tool call, and every change is persisted in SQLite.

> **Honesty note.** This is a self-hosted MCP experience with a web-based demonstration client. It is
> **not** connected to an Alexa+ device, an Alexa+ account, or any restricted Amazon preview tooling.
> When no language model is configured — or a live model fails — a deterministic local planner
> produces the plan and a dismissible notice explains what happened. There is no permanent
> “demo mode” badge.

![Overview dashboard](docs/screenshots/overview.png)

---

## Table of contents

1. [The problem](#the-problem)
2. [What it does](#what-it-does)
3. [Architecture](#architecture)
4. [Why MCP is central](#why-mcp-is-central)
5. [MCP tools and schemas](#mcp-tools-and-schemas)
6. [Quick start](#quick-start)
7. [Environment variables](#environment-variables)
8. [Google AI Studio (Gemma 4) setup](#google-ai-studio-gemma-4-setup)
9. [Voice: speak to HomePilot](#voice-speak-to-homepilot)
10. [Voice reliability audit](#voice-reliability-audit)
11. [Local planner and automatic fallback](#local-planner-and-automatic-fallback)
12. [Testing the MCP server by hand](#testing-the-mcp-server-by-hand)
13. [Running the tests](#running-the-tests)
14. [Screens](#screens)
15. [Known limitations](#known-limitations)
16. [Deployment and judge instructions](#deployment-and-judge-instructions)
17. [Project layout](#project-layout)
18. [Demo video](#demo-video)
19. [License](#license)

---

## The problem

Household coordination is death by a thousand small decisions: what needs buying, who is picking up
the kid, when the bathroom gets cleaned, whether dinner prep collides with a call. Generic chat
assistants can *talk* about it, but they cannot safely change anything — and when they do act, the
action is opaque.

**Target users:** busy two-adult households, shared flats, and anyone who currently runs their home
out of a notes app plus memory.

HomePilot AI is built around one promise: **the assistant proposes, you decide, the server executes —
and you can see exactly what happened.**

## What it does

- **Talk or type.** Speak a request in English or Bengali (where the browser supports it), review or
  edit the transcript, then hear the assistant's answer read aloud — all through the same planning,
  approval and MCP path as typed requests.
- **Conversational planning.** Describe a situation ("Plan a relaxed Saturday for two…") and get a
  structured plan of concrete actions with dates, times, quantities, assumptions and conflict
  warnings.
- **Transparent approval.** Every action is staged first. You can toggle actions off, edit titles,
  dates, times and quantities, then approve or discard. Nothing is written before approval.
- **Real execution through MCP.** On approval the server re-validates the *stored* plan and runs each
  action through the same MCP tool implementation the endpoint exposes — never a client-supplied
  payload, never a mock.
- **Everyday management.** Tasks, schedule and grocery list screens all read and write through MCP
  tools, with confirmation dialogs for destructive operations.
- **Conflict detection.** Overlapping events, duplicate tasks and missing times are flagged before
  approval and shown inline in the Schedule screen.
- **Persistence.** SQLite (via Node's built-in `node:sqlite`) keeps data across reloads and restarts.
- **Visible MCP traffic.** A live panel shows the JSON-RPC you are actually sending: method, tool,
  arguments, duration and result.
- **Honest provider reporting.** Household settings show the configured provider, model and health;
  whenever a live model fails, the response carries a dismissible notice explaining what happened.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Browser (React + TypeScript + Vite + Tailwind)                             │
│                                                                            │
│  Screens: Overview · Assistant · Plan Review · Tasks · Schedule ·          │
│           Groceries · Household                                            │
│           │                                                                │
│           ├── lib/mcp.ts ── official MCP SDK client ──┐                    │
│           │     initialize / tools/list / tools/call   │                   │
│           └── lib/api.ts ── REST for plan lifecycle ──┐│                   │
└───────────────────────────────────────────────────────││───────────────────┘
                                                        ││
                     Streamable HTTP (JSON-RPC)         ││  REST /api/*
                                                        ▼▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Node.js + TypeScript server (Express 5)                                    │
│                                                                            │
│  POST /mcp  ── StreamableHTTPServerTransport (stateless, JSON responses)    │
│      └── McpServer ── 21 tools (src/mcp/tooldefs.ts)                        │
│                 └── Store (SQLite)  ◄── also used by the planner          │
│                                                                            │
│  POST /api/plans           ── propose plan (AI provider adapter)            │
│  PATCH /api/plans/:id      ── edit/disable staged actions                   │
│  POST /api/plans/:id/approve ─ re-validate → execute via tools → log        │
│  POST /api/plans/:id/cancel                                               │
│  GET  /api/status · /api/activity · /api/prompts · /healthz                │
│                                                                            │
│  AI providers: google (Gemma 4) · ollama (Gemma 3 4B) · openai-compatible   │
│  Local planner: automatic, classified fallback (quota / auth / network)    │
└────────────────────────────────────────────────────────────────────────────┘
```

**Layer boundaries**

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `web/src` | Presentation, MCP client, plan review UX |
| HTTP API | `server/src/http` | CORS/Origin checks, MCP endpoint, plan lifecycle, static build |
| MCP tools | `server/src/mcp` | Tool schemas, descriptions, handlers, result shapes |
| Planning | `server/src/services/planner.ts` | Normalisation, validation, conflict checks, safe execution |
| AI | `server/src/services/ai` | Provider adapters + deterministic parser |
| Persistence | `server/src/db`, `server/src/services/store.ts` | SQLite schema, seed data, repositories |

## Why MCP is central

The MCP server is not decoration around a REST app. It is the **only** path that mutates household
data:

- The browser loads every list via `tools/call` (`list_tasks`, `list_schedule`,
  `list_grocery_items`) — the trace panel shows those calls with payloads and durations.
- Every button that changes data calls a tool: `create_task`, `complete_task`,
  `mark_grocery_item_purchased`, `create_schedule_event`, …
- Approved plans are executed by invoking the same registered tool handlers, with arguments
  validated against the same Zod schemas the MCP endpoint advertises in `tools/list`.
- The MCP tools themselves are discoverable by any MCP client (Claude Desktop, MCP Inspector, a
  custom agent). The web app is one client, not a special case.

## MCP tools and schemas

Server implementation: [`server/src/mcp/tooldefs.ts`](server/src/mcp/tooldefs.ts) ·
Transport: [`server/src/mcp/server.ts`](server/src/mcp/server.ts)

Dates are `YYYY-MM-DD`, times are 24-hour `HH:mm`. Every tool returns a JSON payload as text content.

| Tool | Arguments | Purpose |
| --- | --- | --- |
| `get_household_summary` | — | Household, members, counts, today's tasks/events, next events |
| `get_household_preferences` | — | Members and persisted preferences (diet, quiet hours, store…) |
| `get_action_history` | `limit?` | Recent plans and tool actions with timestamps (read-only audit) |
| `list_tasks` | `status?`, `due_date?`, `assignee?` | List tasks |
| `create_task` | `title`, `due_date?`, `due_time?`, `assignee?`, `category?`, `priority?`, `notes?`, `allow_duplicate?` | Create a task (duplicate-safe) |
| `update_task` | `id`, any subset of the fields above, `status?` | Update a task |
| `complete_task` | `id` | Mark complete (idempotent) |
| `delete_task` | `id`, `confirm` | Delete — requires `confirm: true` |
| `list_schedule` | `date?`, `from?`, `to?` | List events (defaults to today onwards) |
| `create_schedule_event` | `title`, `date`, `start_time?`, `end_time?`, `location?`, `notes?` | Create an event, returns conflicts |
| `update_schedule_event` | `id`, subset of fields | Update an event |
| `delete_schedule_event` | `id`, `confirm` | Delete — requires `confirm: true` |
| `check_schedule_conflicts` | `date`, `title?`, `start_time?`, `end_time?` | Overlap check for a candidate or the whole day |
| `list_grocery_items` | `include_purchased?` | List groceries |
| `add_grocery_item` | `name`, `quantity?`, `unit?`, `category?`, `notes?`, `allow_duplicate?` | Add (merges quantity for duplicates) |
| `update_grocery_item` | `id`, subset of fields | Update an item |
| `remove_grocery_item` | `id`, `confirm` | Remove — requires `confirm: true` |
| `mark_grocery_item_purchased` | `id`, `purchased?` | Set purchase state |
| `generate_household_plan` | `request`, `reference_date?` | Turn language into a **proposed** plan (never applies it) |
| `validate_household_plan` | `plan_id` | Re-validate a stored plan + recompute conflicts |
| `apply_approved_plan` | `plan_id`, `confirm` | Execute an approved plan through the tools |

Safety properties:

- Zod validation on both the MCP layer and the planner's execution path.
- Unknown tools and invalid arguments return tool errors (`isError: true`) without crashing the server.
- Destructive tools require an explicit `confirm: true`.
- Duplicate open tasks are refused unless `allow_duplicate: true`; duplicate grocery items merge.
- A plan executes once; re-approval is rejected with HTTP 409.
- The LLM never touches the database. It only produces JSON that is validated into staged actions.

## Quick start

**Requirements:** Node.js **22.5+** (Node 24 recommended — the project uses the built-in
`node:sqlite` module, so there are no native build steps), npm 9+.

```bash
# 1. Install (from the repository root; installs both workspaces)
npm install

# 2. Optional: copy the environment template
cp .env.example .env          # Windows: copy .env.example .env

# 3. Run the API/MCP server + the web dev server together
npm run dev
```

Then open **http://localhost:5173**.

- Web app: `http://localhost:5173`
- REST API: `http://localhost:8787`
- **MCP endpoint: `http://localhost:8787/mcp`** (Streamable HTTP)
- Health: `http://localhost:8787/healthz`

The first start seeds a sample household (Riverdale Home: Elena, Marcus, Leo) with three tasks, a
completed task, three events and four grocery items so the app is never empty.

Production-style single process:

```bash
npm run build     # type-checks and builds server + web
npm start         # serves the built UI and the API/MCP endpoint on :8787
```

## Environment variables

All are optional; without a `.env` the app runs on the local planner. See [`.env.example`](.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | API + MCP port |
| `HOST` | `127.0.0.1` | Bind address (loopback keeps DNS-rebinding protection meaningful) |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed browser origins (also enforced on `/mcp`) |
| `DATABASE_PATH` | `./data/homepilot.db` | SQLite file (relative to the server workspace) |
| `SEED_ON_START` | `false` | Wipe + reseed sample data on boot |
| `AI_PROVIDER` | `demo` | `google` (alias `gemini`) \| `ollama` \| `openai-compatible` \| `demo` |
| `GEMINI_API_KEY` | — | Google AI Studio key (server-side only) |
| `GEMINI_MODEL` | `gemma-4-26b-a4b-it` | Gemma model id hosted by the Gemini API |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Gemini API base URL |
| `GOOGLE_TRANSCRIPTION_ENABLED` | `true` | Enable the optional server transcription endpoint when a key exists |
| `GOOGLE_TRANSCRIPTION_MODEL` | `gemini-3.5-transcribe` | Google speech-to-text model id |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `gemma3:4b` | Model name to request |
| `OLLAMA_API_KEY` | — | Only for a remote/authenticated Ollama |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible base URL |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name |
| `OPENAI_API_KEY` | — | Server-side key; never exposed to the browser |
| `VITE_API_BASE` | — | Only needed if the web app is served from a different origin |

`.env` is loaded from the repository root (the documented location) or from `server/.env` when the
server runs from that workspace, and is git-ignored. Never commit real keys. Restart the server
after changing it — environment variables are read once at boot.

## Google AI Studio (Gemma 4) setup

The planner uses a provider adapter; model calls happen only on the server. The browser never sees a
key and never calls Google directly.

### 1. Create a key

Open <https://aistudio.google.com/apikey>, create a free API key, and put it in `.env` — not in the
frontend, not in Git:

```bash
AI_PROVIDER=google
GEMINI_API_KEY=your-key-from-ai-studio
GEMINI_MODEL=gemma-4-26b-a4b-it
```

### 2. Pick the Gemma model id

The Gemini API hosts two Gemma 4 models today:

| Model id | Notes |
| --- | --- |
| `gemma-4-26b-a4b-it` | 26B total **4B active** parameters (default here — the closest hosted match to “Gemma 4B”) |
| `gemma-4-31b-it` | dense 31B, higher quality, slower |

Check what your key can see before choosing:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it?key=$GEMINI_API_KEY"
```

If you specifically want a dense 4B model running locally, use the Ollama path below with
`gemma3:4b`. **“Gemma 4B” is not a single official model name**, so the exact id is configurable and
the app never hardcodes a capability it has not verified.

### 3. Restart and verify

```bash
npm run dev
```

Household & Memory → **Planning model** shows the provider, model, endpoint and a live health line.
Plans created with the model are marked `live` internally; the UI no longer carries a permanent
mode badge. If the key is missing, rejected, rate-limited or out of credits, the server answers with
the local planner and returns a **one-time notice** (see below).

### How the model is asked

The Gemini adapter calls `POST {GEMINI_BASE_URL}/models/{model}:generateContent` with a system
instruction, the household context, and `responseMimeType: application/json`. The JSON is parsed with
Zod, retried once with the validation error if malformed, and then converted into staged MCP actions.
The model never touches SQLite: it can only propose, and only the planner can apply.

### Ollama alternative (free, fully local)

```bash
ollama pull gemma3:4b
ollama serve

# .env
AI_PROVIDER=ollama
OLLAMA_MODEL=gemma3:4b
```

### Any OpenAI-compatible endpoint

```bash
AI_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://your-endpoint/v1
OPENAI_MODEL=your-model
OPENAI_API_KEY=sk-...      # keep this in .env only
```

**Manual setup you must do yourself:** create the Google AI Studio key (or install Ollama / obtain an
endpoint key), choose the model id, and set the variables above. Nothing is invented: if the provider
is unreachable or a key is missing, `/api/status → providerHealth` reports it and the UI shows it.

## Voice: speak to HomePilot

Voice is an input and output layer on the **existing** assistant — not a second chatbot. A spoken
request becomes text in the composer, you review it, and sending it uses the same plan proposal,
validation, review, approval and MCP execution path as a typed request. Voice can never approve a
plan or run a destructive action.

The input layer is provider-based:

| Provider | What it does | Uploads audio? |
| --- | --- | --- |
| **Browser speech** (default) | `SpeechRecognition` / `webkitSpeechRecognition` | Chrome/Edge send to their own speech service; HomePilot never receives the audio |
| **Google transcription** (optional) | Server endpoint uploads one short recording to Google AI and returns text | Yes — only when you press the mic with this provider selected |
| **Text input** | Always available, regardless of browser or server configuration | No |

Push-to-talk is always available. **Hands-free** is an explicit, per-session toggle; there is **no wake
word** (“Hey HomePilot” is not implemented). The microphone is open only while listening, closes while
HomePilot thinks or speaks, and closes on Stop, Esc, tab hide or navigation.

### What is supported

| Capability | Implementation |
| --- | --- |
| Speech → text | Browser Web Speech API, or optional Google `gemini-3.5-transcribe` |
| Text → speech | Browser-native `speechSynthesis` + `SpeechSynthesisUtterance` |
| Languages | `en-US` and `bn-BD`; Google transcription also supports `auto` detection |
| Push-to-talk | Mic button, live interim transcript, editable result, stop/cancel/retry |
| Hands-free | Toggle, auto-send after a short review delay, resume after speech, pause on error/Stop |
| Spoken replies | Per-message Read aloud/Stop, optional auto-speak, voice picker, rate and volume |
| Failure states | Permission denied, no microphone, no speech, service failure, unsupported language, unsupported browser, cloud unavailable |
| Privacy | No audio persisted by HomePilot; cloud uploads are explicit and the temporary Google file is deleted |

There is **no paid speech API** in the default configuration, and spoken replies use the operating
system/browser voices — never a “premium neural voice”.

### The push-to-talk flow

1. Open **AI Assistant** and press the microphone.
2. The browser asks for microphone permission the first time; nothing opens before you press it.
3. The composer shows *Waiting for microphone…* then *Listening…* (browser) or *Recording — press
   stop* (Google), with a live transcript where available and a subtle waveform.
4. A final transcript is placed in the textarea — edit it before sending.
5. Send with the button or Enter. The plan is generated exactly as a typed request would be.
6. The answer appears in the conversation and is read aloud if **Speak answers automatically** is on,
   or when you press **Read aloud** on a message.
7. Open **Review the proposed plan**, adjust actions, and approve. Execution happens through MCP.

### Hands-free mode

Press the headphones button next to the mic (or read the state in **Voice replies**). Hands-free:

1. starts only after that deliberate click;
2. detects the end of an utterance, transcribes it and sends it automatically unless you edit it;
3. speaks the answer when auto-speak is on;
4. waits until speech synthesis has finished, then reopens the microphone;
5. pauses on Stop/Esc, a microphone error, or when the tab is hidden;
6. is **not persisted** — every page load requires a fresh opt-in.

If the browser refuses to resume recognition, the error is shown and hands-free turns itself off
instead of silently pretending to listen. Turn **Speak answers automatically** on as well for a real
conversation; hands-free still works visually with it off.

### The “speech recognition is offline” error

The Web Speech API's `network` event means only that communication needed for recognition failed. It
does **not** mean your internet is offline, and it does not identify an outage, firewall, VPN,
policy or language problem. HomePilot now says that plainly, retries **once** after a visible notice,
and then offers real recovery steps. Read the full analysis in
[the voice reliability audit](docs/VOICE_AUDIT.md).

If the browser service keeps failing and Google transcription is configured, press **Use Google
transcription** in the error card (or select it in Voice replies). Audio is uploaded only after that
explicit choice.

### Browser compatibility

| Browser | Speech input | Speech output | Notes |
| --- | --- | --- | --- |
| Chrome / Edge (desktop) | Yes | Yes | Recognition uses the browser's remote service and needs network access |
| Safari (macOS/iOS) | Partial | Yes | Availability and language coverage vary by OS version |
| Firefox | No | Yes | `SpeechRecognition` is not implemented; the mic is disabled with an explanation and typing still works |
| Chrome on Android | Yes | Yes | Uses the system/browser recognizer |

Feature detection is real: the mic button is enabled only when a `SpeechRecognition` constructor (or
a working recorder, for Google transcription) exists. Bengali recognition depends on the engine;
Google transcription lists `bn-BD` and `bn-IN`, but the browser's recognizer may reject it. When that
happens the app says so and suggests English, Google transcription, or typing.

### Google transcription setup (optional)

Add to `.env` (the same key used for Gemma):

```bash
GEMINI_API_KEY=...
GOOGLE_TRANSCRIPTION_ENABLED=true
GOOGLE_TRANSCRIPTION_MODEL=gemini-3.5-transcribe
```

Restart the server. `GET /api/status → transcription` reports availability without exposing the key.
The server accepts a short recording (WebM/Ogg/MP4/WAV, 8 MB limit) on `POST /api/transcribe`, uses
Google's Files API, passes `audioTranscriptionConfig.languageCodes`, returns only text, and best-effort
deletes the temporary Google file. Audio is held in memory and never written to SQLite or disk. If no
key is configured, the option is disabled in the UI and browser speech/typing remain available.

> The cloud adapter is covered by mocked HTTP tests, but **not live-verified** in this repository
> because no API key is present in the environment. Do not treat it as verified until you run it with
> your own key.

### English and Bengali

The language selector sets the recognizer language and the speech-synthesis language. Bengali output
requires a Bengali voice installed on the device; if none exists, the voice picker says so and the
browser may fall back to another accent. The written answer is always available. Bengali recognition
is offered, but support is engine-dependent and is never claimed when the recognizer rejects it.

### Spoken replies and playback settings

**Voice replies** (Assistant → right column) controls:

- **Speech input** — Browser or Google transcription (disabled unless configured).
- **Speak answers automatically** — off by default; applies to typed and spoken requests.
- **Voice** — any installed voice, with an *Automatic (best match)* choice.
- **Rate** (0.70×–1.30×) and **Volume** (0–100%), plus **Preview voice**.

Playback rules: only **new** assistant answers are auto-spoken — restored history is never read on
load; a new answer, Stop, a language switch or leaving the Assistant cancels previous speech; an
answer is never spoken twice automatically. Errors use calm generic speech and never expose HTTP
codes, provider diagnostics or credentials.

### Read-only commands and real MCP actions

A conservative command router keeps simple questions out of the plan workflow and answers them
through the **real MCP server**:

| Say | What happens |
| --- | --- |
| “What do I need to do today?” | `get_household_summary` → today's tasks, events and grocery count |
| “What's on my schedule?” | `list_schedule` |
| “What do I need to buy?” | `list_grocery_items` |
| “What did you change?” | `get_action_history` |
| “Check for schedule conflicts” | `check_schedule_conflicts` for today |
| “Cancel that last proposed change” | cancels the newest open plan; no data is changed |
| “I already bought milk” | `mark_grocery_item_purchased` after resolving one match |

If a request is ambiguous, a match is missing or several items match, HomePilot asks instead of
guessing. Everything else — including multi-step planning, reminders and rescheduling — goes through
the same propose → review → approve path. **A spoken “yes” never approves a plan**; approval is
always the reviewed button, which prevents an uncertain transcript from authorising changes.

### How voice meets Gemma and MCP

```
speech → editable text → read-only command? ── yes → real MCP tool → answer → speech
                                   │ no
                                   └→ POST /api/plans → Google AI Studio (Gemma)
                                            └─ failure/quota → deterministic planner
                      → structured plan → Review → Approve → MCP tools → SQLite
                      → answer text → browser speechSynthesis
```

Both modes share conversation state, household context, provider handling, validation, conflict
detection, approval, MCP execution and persistence. When credits are exhausted, a spoken request gets
the same result as a typed one: the exact notice **“API credits exhausted. Demo mode is now active.”**
appears once with that response, the plan remains reviewable and executable, and the spoken answer
reads the useful plan summary without repeating the notice or any internal error.

### Testing voice fallback

1. Household & Memory → **Resilience test** → *Simulate quota exhaustion*. No credits are used.
2. Return to **AI Assistant** and speak (or type) a request.
3. The fallback notice appears once, the deterministic plan is shown, and — with auto-speak on — the
   summary is read aloud without the notice.
4. Approve the plan: actions still execute through the real MCP tools.
5. Send another request: the provider is back to normal and the notice is gone.

**Manual verification required.** Browser speech APIs cannot be exercised in a headless suite: run
the app in Chrome or Edge, grant microphone access, and confirm recognition, the permission error
path, hands-free turn-taking and audible playback on your machine. Automated tests mock the browser
APIs and verify the state machine, retry, cloud capture, transcript editing, duplicate-submit guard,
fallback integration and playback controls.

## Voice reliability audit

The original “Speech recognition is offline” message was a **UI misdiagnosis**, not a network test.
The Web Speech API's `network` event only says that recognition communication failed; it does not
identify connectivity, a service outage, a firewall/VPN, a policy or an unsupported language. The old
copy asserted a cause the browser never reported.

Read [docs/VOICE_AUDIT.md](docs/VOICE_AUDIT.md) for the full inspection, the contributing lifecycle
bugs, what changed (honest copy, one bounded retry, provider abstraction, cloud fallback,
hands-free turn-taking) and exactly what remains unverified. It is deliberately written as an audit,
not marketing copy.

## Local planner and automatic fallback

Without a configured provider (or whenever a live model fails), plans are produced by a deterministic,
rule-based local planner. It needs no network and no credentials, and re-running the same request
produces identical output — useful for a reproducible judged demo.

Failures are **classified**, not swallowed:

| Condition | What the user sees | Behaviour |
| --- | --- | --- |
| `429` with quota / billing / `RESOURCE_EXHAUSTED` | **“API credits exhausted. Demo mode is now active.”** | Local plan + dismissible notice |
| Short-term rate limit | A rate-limit notice | Local plan, retry later |
| Invalid or missing key (`401/403`) | Provider unavailable notice | Local plan |
| Model id missing (`404`) | Configuration notice | Local plan |
| Empty/blocked/invalid JSON twice | “could not answer” notice | Local plan |
| Network failure/timeout | Reachability notice | Local plan |

The notice is **transient**: it appears in the response that triggered it, can be dismissed, and is
not a permanent label anywhere in the app. Every MCP tool, approval step and persisted change keeps
working while it is shown.

### Controlled quota test (no real credits used)

Household & Memory → **Resilience test** → *Simulate quota exhaustion* arms **one** request to behave
exactly like a `429 / RESOURCE_EXHAUSTED` response. It makes no provider call, uses no credits, shows
the required notification and still produces a reviewable plan. The next request goes back to the
configured provider normally.

The same test is available over HTTP:

```bash
curl -s -X POST http://localhost:8787/api/provider/simulate-quota
curl -s -X POST http://localhost:8787/api/plans \
  -H 'content-type: application/json' \
  -d '{"request":"Add oat milk and lemons to the grocery list"}' | jq '.fallback'
# { "notice": "API credits exhausted. Demo mode is now active.", "kind": "quota", "simulated": true, ... }
```

This is a simulation, not a billing event; the UI and docs say so explicitly.

## Testing the MCP server by hand

### 1. Raw JSON-RPC with curl

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

```bash
# Tool discovery
curl -s -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

```bash
# Create a task through the real endpoint
curl -s -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_task","arguments":{"title":"Test from curl","due_date":"2026-11-01","priority":"high"}}}'
```

```bash
# Generate a plan, then approve it through MCP (confirm is required)
curl -s -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"generate_household_plan","arguments":{"request":"Add oat milk and lemons to the grocery list"}}}'
```

Notes:

- `accept: application/json, text/event-stream` is required by the Streamable HTTP spec; a request
  without it gets `406`.
- The transport is stateless: a new server instance is created per request, so no session header is
  needed and `DELETE /mcp` returns `405` (documented behaviour).
- Unknown methods return JSON-RPC `-32601`; invalid tool arguments return a tool result with
  `isError: true` and a readable validation message.

### 2. MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# transport: Streamable HTTP
# URL: http://localhost:8787/mcp
```

### 3. From the web app

Open the app: the “MCP traffic” panel lists `initialize`, `tools/list` and every `tools/call` with its
arguments and duration. Household → **Run MCP self-test** performs a fresh `tools/list` +
`get_household_summary` round-trip and reports the result.

## Running the tests

```bash
npm test                  # server integration + unit tests (Vitest)
npm run typecheck         # server + web TypeScript
```

The suite covers, against the **real HTTP server** (no mocks):

- MCP `initialize` / protocol negotiation via the official SDK client and via raw JSON-RPC.
- `tools/list` (21 tools, descriptions, JSON Schemas), including `get_action_history`.
- `tools/call` happy paths for tasks, groceries, schedule.
- Invalid tool input, unknown records, unknown tools, missing `confirm`.
- Duplicate-task and grocery-merge behaviour.
- Schedule conflict detection (unit + via tool).
- Plan proposal → edit → approve → execution through tools; cancel; double-apply rejection; invalid
  action blocking.
- Persistence across a database close/reopen and a full server restart.
- Google AI Studio adapter: success, unsupported-field retry, `429` quota, invalid key, missing key.
- Failure classification (quota vs rate limit vs auth vs upstream) and the exact fallback notice.
- Controlled quota test: one-shot simulation, no provider call, normal service afterwards.
- Optional Google transcription endpoint: missing key, Files API upload, language hint, temp-file
  deletion, quota mapping, empty/unsupported/oversized audio.

Web (Vitest + jsdom, browser APIs mocked):

- Feature detection and the unsupported-browser explanation (typing still works).
- Recognition success, interim transcripts, stopping without submitting, permission denial,
  language selection and the duplicate-submit guard.
- Recognized text editing before submission.
- Speech sanitization, voice selection, sentence chunking, playback, cancellation and error copy.
- Auto-speak on/off, manual read-aloud, no speaking of restored history, and cleanup on unmount.
- One bounded retry for `network`, honest non-“offline” copy, and no retry loop.
- Cloud capture: explicit start, MediaRecorder upload, permission denial, no speech, quota failure,
  abort and maximum-duration cleanup.
- Hands-free auto-send, persistent indicator, and pause-on-stop behaviour.
- Conservative command routing: read-only questions, “what changed”, cancel, purchased items and
  non-command planning requests.
- Integration: a spoken request goes through `proposePlan` and opens the same plan review; read-only
  and grocery commands run through MCP without creating a plan.

Current status: **149 tests passing** across 17 files (59 server, 90 web).

## Screens

| Screen | What it shows |
| --- | --- |
| ![Overview](docs/screenshots/overview.png) | Today's plan, quick prompt bar, grocery snapshot, MCP traffic |
| ![Assistant](docs/screenshots/assistant.png) | Conversation, suggestions, JSON-RPC trace, household context |
| ![Plan review](docs/screenshots/plan-review.png) | Staged actions by domain, assumptions, conflicts, approve/discard |
| ![Applied](docs/screenshots/plan-applied.png) | Per-action execution report from the server |
| ![Tasks](docs/screenshots/tasks.png) | Filters, plan provenance, priorities, add form |
| ![Schedule](docs/screenshots/schedule.png) | Day groups, conflict warnings, add-event dialog |
| ![Groceries](docs/screenshots/groceries.png) | Category groups, quantities, purchased state |
| ![Household](docs/screenshots/household.png) | Provider health, MCP endpoint, tool registry, resilience test |
| ![Quota fallback](docs/screenshots/quota-fallback.png) | The required notice after a simulated quota-exhausted response |

## Known limitations

- **No authentication.** The server is meant to run on localhost for a single household. Do not expose
  it to the internet without adding auth and per-user scoping.
- **Stateless MCP transport.** No server-initiated notifications or SSE resumability; requests return
  JSON. This is the documented stateless pattern and fits a request/response UI.
- **Preferences are read-only in the UI.** Household preferences are seeded and exposed via
  `get_household_preferences`, but there is no edit control yet.
- **Planner scope.** Plans can create/update/complete tasks, create/update events, and add/update/mark
  groceries. Deleting through a plan is intentionally not supported.
- **No confirmation-free bulk operations.** By design, one approval executes the enabled actions; a
  partial failure marks the plan `partially_applied` and reports exactly which actions failed.
- **Local planner is pattern-based.** It handles the phrasing shown in the suggestions well and falls
  back to a single task otherwise; it does not understand arbitrary language. That is what a live
  model is for.
- **Model quality is not guaranteed.** A small model may return invalid JSON; the app retries once and
  falls back, then tells you it did.
- **“Gemma 4B” is a family description, not a model id.** The default hosted id is the 4B-active
  `gemma-4-26b-a4b-it`; use `GEMINI_MODEL` to select another id, or Ollama for `gemma3:4b`.
- **The quota test is a simulation.** It produces the exact `429 / RESOURCE_EXHAUSTED` shape and the
  required notice, but it does not consume or verify real billing credits.
- **Voice support is browser-dependent.** Speech recognition requires Chrome/Edge (or a browser that
  implements the Web Speech API). Firefox has no `SpeechRecognition`, so voice input is explained and
  disabled there while typing continues to work.
- **Voice quality is browser-native.** Spoken replies use the operating system voices exposed by
  `speechSynthesis`; there is no premium neural voice, and Bengali output requires a Bengali voice
  installed on the device. Recognition accuracy varies with microphone and environment.
- **Recognizers may use the network.** Chrome's speech recognition sends audio to Google's speech
  service, outside this app's control. The optional Google transcription provider uploads one short
  recording to this app's server only after an explicit provider choice and mic press; HomePilot
  stores no audio and deletes the temporary Google file. The cloud adapter is tested against a
  mocked Google API but was not live-verified here (no key configured).
- **No wake word or always-on listening.** “Hey HomePilot” is not implemented. The microphone opens
  only on an explicit press, and hands-free turn-taking requires a fresh per-session opt-in and a
  visible tab; it pauses on Stop/Esc, errors and tab hide.
- **Voice never approves a plan.** A spoken “yes” cannot apply changes; the reviewed button remains
  the only approval path. This is deliberate protection against uncertain transcripts.
- **No undo in the UI.** Destructive MCP tools require `confirm: true`, plans cannot contain delete
  tools, and cancelled plans change nothing, but there is no one-click revert of an applied plan.
- **Command routing is intentionally narrow.** Only the explicit read-only/reversible phrases listed
  above bypass the planner; other language is treated as a planning request, not executed directly.
- **No live Alexa+ connection.** Nothing here is registered with or deployed to an Alexa+ device or
  Amazon preview account; the MCP server is self-hosted and the client is this web app.
- **Single-process deployment.** SQLite + in-process tools means one server instance.

## Deployment and judge instructions

**Local (recommended for judging):**

```bash
git clone <your-fork-url> homepilot-ai
cd homepilot-ai
npm install
npm run dev
# open http://localhost:5173, MCP endpoint http://localhost:8787/mcp
```

**Single-process (no Vite):**

```bash
npm install
npm run build
npm start        # http://localhost:8787 serves the built UI, API and /mcp
```

**Judge checklist (about 2 minutes):**

1. Open the app — note the sidebar shows `MCP connected · 21 tools`.
2. Click a suggested prompt on Overview.
3. On Plan Review, disable one action, edit a time, and read the assumptions/conflict notes.
4. Approve. The next screen is the server's own per-action report, each row naming the MCP tool used.
5. Open Tasks / Schedule / Groceries — the new records are there with a `from plan` badge.
6. Reload the page — the data is still there (SQLite).
7. Expand **MCP traffic** to see the actual JSON-RPC calls, or run `curl` against `/mcp` from the
   commands above.
8. Household & Memory → **Resilience test** → *Simulate quota exhaustion*. The next screen shows
   exactly `API credits exhausted. Demo mode is now active.`, the plan is still reviewable, and
   nothing was applied. The notice is dismissible and marked as simulated.
9. Household → **Run MCP self-test** proves a live `tools/list` + `tools/call` round-trip.

**If you want to expose it publicly** (not required): put it behind a reverse proxy with TLS and add
authentication first. The app binds to `127.0.0.1` by default; there is no public deployment in this
submission.

## Project layout

```
.
├── server/                  # Node + TypeScript API and MCP server
│   ├── src/
│   │   ├── index.ts         # entrypoint (env, db, listen)
│   │   ├── config.ts        # env parsing
│   │   ├── db/db.ts         # SQLite schema + sample data
│   │   ├── domain/          # types, date helpers, conflicts
│   │   ├── mcp/             # tool registry + MCP server/transport
│   │   ├── services/        # store, planner, ai providers, transcription
│   │   └── http/app.ts      # Express app: /mcp, /api, static build
│   └── test/                # Vitest integration + unit tests
├── web/                     # React + Vite + Tailwind client
│   └── src/
│       ├── lib/             # MCP client, REST client, commands/, voice/
│       ├── hooks/           # useVoiceInput, useSpeechOutput
│       ├── state/           # app state (all mutations via MCP) + voice prefs
│       ├── components/      # shell, composer, voice settings, activity, primitives
│       └── screens/         # Overview, Assistant, PlanReview, Tasks, …
├── docs/                    # demo script, feedback, friction log, screenshots
├── Design/                  # provided visual reference (kept for provenance)
├── .env.example
└── README.md
```

## Project docs

| Document | Contents |
| --- | --- |
| [Workflow](docs/WORKFLOW.md) | End-to-end: input → plan → validate → approve → real MCP execution → persistence |
| [Video script](docs/VIDEO_SCRIPT.md) | Shot-by-shot, timed submission video script with recording checklist |
| [Voice audit](docs/VOICE_AUDIT.md) | Root cause of the “offline” message, fixes, and unverified limits |
| [Demo script](docs/DEMO_SCRIPT.md) | A timed <3 minute walkthrough with recording checklist |
| [Feedback](docs/FEEDBACK.md) | Product and API feedback gathered while building this |
| [Friction log](docs/FRICTION_LOG.md) | Real issues, root causes and fixes |
| [Publishing checklist](docs/PUBLISHING.md) | GitHub, release, secrets audit and Devpost steps |

## Demo video

_Placeholder — record the video following [`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md)
(shot-by-shot, ~3 min, built on what recent Amazon/AWS and MCP hackathon winners did) and link it
here (YouTube/Vimeo/Drive) before submitting. A tighter live-run variant is in
[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)._

## License

MIT.
