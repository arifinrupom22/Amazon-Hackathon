# HomePilot AI — Website Workflow

This document describes **exactly how HomePilot AI works end to end** — from a spoken or typed
request to a persisted change in the household database — and maps every feature to the part of
the system that implements it. Nothing here is aspirational; each step names real code that runs
today.

---

## 1. The one-sentence workflow

> **You speak or type a household request → HomePilot turns it into a structured plan of real MCP
> tool calls → you review, edit and approve it → the server executes those exact tools → the change
> is persisted in SQLite and shown back to you (visually and, if enabled, spoken).**

The defining design decision: **the language model never touches the database.** It only *proposes*.
Every write is a schema-validated MCP tool that runs after explicit human approval. This is the
"cite-before-act" / human-in-the-loop pattern — the same pattern that won **Best Overall** at the
MCP 1st Birthday Hackathon — and it is the spine of the whole product.

---

## 2. End-to-end flow diagram

```text
┌────────────────────────────  YOUR INPUT  ────────────────────────────┐
│                                                                      │
│  Push-to-talk mic ──► Browser Speech API ──┐                         │
│  (or hands-free)      (Web Speech / STT)   │   ┌── optional cloud    │
│                                            ├──►│ transcription       │
│  Keyboard ─────────────────────────────────┘   │ (Google, server-   │
│                                                │  side key, explicit │
│                                                │  user action only)  │
│                                                └─────────────────────┘
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
                 Transcript lands in the composer —
                 fully editable before you send. Text
                 input is always available as fallback.
                                │  (submit)
                                ▼
┌──────────────────────  SERVER PLANNING LAYER  ───────────────────────┐
│  POST /api/plans  →  Planner.propose()                              │
│                                                                      │
│  • Read-only / trivially-reversible commands ("what's today?",       │
│    "I bought milk") are routed to a single MCP tool call directly.   │
│  • Everything else goes to the model:                                │
│        – Provider: Gemma via Google AI Studio (if configured)        │
│        – Fallback: deterministic local planner (offline / quota)     │
│  • Model is required to return STRUCTURED, schema-shaped actions.    │
│  • Household context (members, diet, quiet hours, store) is injected │
│    so the plan is genuinely personalized.                            │
│                                                                      │
│  Output: a PROPOSED plan — nothing written yet.                      │
│  Also computed: conflicts, duplicates, assumptions, clarification    │
│  question (if a date/time is ambiguous), and measured latencyMs.     │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────  VALIDATION & SAFETY  ─────────────────────────┐
│  Every proposed action is re-validated against the REAL MCP tool     │
│  JSON Schemas (input shape, types, enums, required fields).          │
│  • Schedule overlap detection                                        │
│  • Duplicate-action prevention                                       │
│  • Risk classification (read-only / reversible vs. consequential)   │
│  • Ambiguous dates require confirmation, not a guess                 │
│  Invalid actions are rejected here — before any approval screen.     │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────  REVIEW & APPROVAL (human)  ───────────────────┐
│  Plan Review screen:                                                 │
│  • "Staging mode — nothing has been written yet."                    │
│  • Toggle individual actions on/off                                  │
│  • Edit an action's details (e.g. change a cleaning time)            │
│  • See the exact tool name + validated arguments per row             │
│  • Conflict / sanity warnings shown inline                          │
│                                                                      │
│  [ Approve & apply ]   [ Discard ]                                   │
│  A spoken "yes" only ever approves the *currently pending, clearly   │
│  identified* proposal — stale requests expire and can't be approved  │
│  by unrelated speech.                                                │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼  (only on Approve)
┌──────────────────────  REAL MCP TOOL EXECUTION  ─────────────────────┐
│  POST /api/plans/:id/approve                                         │
│  → Planner re-validates the STORED plan (never a client payload)     │
│  → executes each enabled action by calling the SAME tool             │
│    implementations the /mcp endpoint exposes.                        │
│  → per-action result: ok / failed / skipped, with the tool that ran  │
│  → partial failure is reported honestly (one failed action does not  │
│    silently pretend the others didn't run).                          │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────  PERSISTENCE & RESULT  ────────────────────────┐
│  • Records written to SQLite (survives restart — proven by a test).  │
│  • New records carry a "from plan" provenance badge.                 │
│  • Action history / audit log records every operation with a         │
│    timestamp, origin and the tool used.                              │
│  • UI refreshes from the server; visual + optional spoken            │
│    confirmation names exactly which actions succeeded or failed.     │
│  • Supported reversible actions can be undone.                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. The workflow, screen by screen

| # | Screen / surface | What happens there |
|---|---|---|
| 1 | **Overview** | Household at a glance: open tasks, events today, groceries to buy, live `MCP connected · 21 tools`, and the real JSON-RPC MCP traffic panel. |
| 2 | **AI Assistant** | Speak or type. Choose voice language (English / বাংলা). Toggle push-to-talk vs. hands-free. Transcript appears live, editable, before sending. Plan proposal appears with its measured latency. |
| 3 | **Plan Review** | Staging area. Edit, toggle, and inspect each action's real tool + arguments. Conflicts and assumptions shown. Approve or discard. |
| 4 | **Execution report** | The server's own per-action report — not a success toast — naming the tool that ran each action, with ok/failed/skipped status. |
| 5 | **My Tasks / Schedule / Groceries** | Persisted data, refreshed from the server, with `from plan` provenance badges. |
| 6 | **Household & Memory** | Inspect/edit/delete saved preferences, view action history, reset sample data, and run the controlled resilience test. |

---

## 4. Voice input workflow (three distinct modes)

HomePilot distinguishes three interaction modes so it never pretends to do something it can't:

1. **Push-to-talk** — press the mic, speak, release. Live transcript, waveform while listening,
   stop/cancel/retry. Best for consequential commands (you always see and can edit the text first).
2. **Hands-free conversation** — an explicit opt-in toggle. Listens → transcribes → answers →
   speaks the reply → listens again. The microphone is **off while HomePilot speaks** (so it never
   hears itself), and it turns off on reload, on Stop, or on Esc. A persistent indicator shows when
   the mic is live.
3. **Optional wake word** — *investigated and deliberately out of scope.* No reliable on-device
   browser wake-word engine exists, so HomePilot does **not** claim "Hey HomePilot." Push-to-talk and
   hands-free are the honest, finished paths.

**Speech-to-text is provider-based**, with runtime support detection:
- **Browser Speech provider** (default) — uses `SpeechRecognition` / `webkitSpeechRecognition`. Every
  error (`network`, `not-allowed`, `service-not-allowed`, `no-speech`, `audio-capture`,
  `language-not-supported`, `aborted`) is handled with a specific, honest message — it never simply
  says "offline."
- **Cloud transcription provider** (optional) — a server-side Google adapter. The key stays on the
  server, audio is uploaded only on explicit user action, and raw audio is never persisted.
- **Text input** — always available, so a speech failure never blocks you.

**Speech output** uses the free browser `speechSynthesis`: per-message replay, stop, auto-reply
toggle, real voice selection, rate/volume. A TTS failure never breaks command execution, and old
conversation is never auto-read after a refresh.

---

## 5. How the "brain" stays safe

```
Natural language ──► Model (or local planner) ──► STRUCTURED actions ──► Schema validation ──► Human approval ──► Real MCP tools ──► SQLite
        (untrusted text)      (proposes only)        (JSON, not prose)      (reject bad input)      (you say yes)        (the only writer)
```

- The model is **prompted and constrained** to return schema-shaped actions, and every field is
  re-validated on the backend. Model text can never execute arbitrary code, SQL, or unrestricted URLs.
- **Deterministic fallback:** if the provider is unconfigured, rate-limited, or out of quota, a local
  planner answers a defined subset of common commands — using the **same real MCP tools** — and
  reports unsupported requests honestly. It never fabricates success. Quota exhaustion shows the
  exact message *"API credits exhausted. Demo mode is now active."* only when that fallback truly
  activates, behind a controlled, credit-free simulation for demos.
- **Consequential vs. reversible:** read-only queries and clearly reversible actions can follow your
  autonomy preference; destructive or multi-step actions require explicit confirmation.

---

## 6. The MCP layer (why it's real)

- A genuine **Model Context Protocol server** over **Streamable HTTP** at `/mcp`, speaking
  `initialize`, `tools/list`, and `tools/call` with correct JSON-RPC — verified by tests using the
  **official TypeScript MCP SDK client**, the same path the web app uses.
- **21 schema-validated tools** across tasks, schedule, groceries, planning, history and undo — each
  with an accurate description, a JSON Schema for inputs, structured output and real business logic.
- The **web UI is itself just an MCP client** — every read and write it performs is a `tools/call`,
  visible live in the on-screen **MCP traffic** panel. There are no local arrays standing in for data.
- Security follows the official guidance: **Origin validation**, appropriate binding for local dev,
  and no secrets in the client.

---

## 7. Feature map (feature → where it lives)

| Feature | Implemented in |
|---|---|
| Push-to-talk, hands-free, live transcript | `web/src/lib/voice/*`, `useVoiceInput`, `AssistantComposer` |
| Provider-based STT + text fallback | `web/src/lib/voice/recognition.ts`, `cloudCapture.ts`, `server /api/transcribe` |
| Speech output (replay, stop, voices, rate/volume) | `web/src/lib/voice/synthesis.ts`, `useSpeechOutput` |
| Structured planning + schema validation | `server/src/services/planner.ts` |
| Gemma provider + deterministic fallback + error classification | `server/src/services/ai/*` |
| Review / edit / approve / cancel | `web/src/screens/PlanReview.tsx`, `server /api/plans/*` |
| Real MCP server (21 tools) + official-SDK tests | `server/src/mcp/*`, `server/test/mcp-endpoint.test.ts` |
| Conflict + duplicate detection | `server/src/domain/conflicts.ts` |
| Persistence (SQLite) + audit history + undo | `server/src/services/store.ts` |
| Live MCP traffic panel | `web/src/lib/mcp.ts`, `web/src/components/Activity.tsx` |
| Multi-turn command routing (today/bought/cancel/what-changed) | `web/src/lib/assistant/commands.ts` |
| Privacy controls, sample-data reset, resilience test | `web/src/screens/Household.tsx` |

---

## 8. Running it locally

```bash
npm install
npm run dev          # server on http://localhost:8787, web on http://localhost:5173
```

- Backend + MCP: `npm run dev:server` → MCP endpoint at `http://localhost:8787/mcp`
- Frontend: `npm run dev:web`
- Tests / types / build: `npm test` · `npm run typecheck` · `npm run build`

No API key is required — the app runs fully on the deterministic local planner. To use a live model,
set `AI_PROVIDER=google` and `GEMINI_API_KEY` (server-side only).

---

## 9. Honest limitations

- Browser speech **recognition** needs Chrome/Edge (they route audio to their own speech service);
  Firefox/Safari fall back to text input with a clear notice. Bengali recognition/voices depend on
  installed browser/OS voices.
- Browser **synthesis** quality depends on installed system voices; a missing Bengali voice shows a
  helpful message and keeps the readable text.
- No wake word, and no background listening while a tab is suspended — deliberately not claimed.
- No official Alexa+/Amazon integration. HomePilot is an **independently built, self-hosted,
  web-based conversational household agent with a real MCP server.**
