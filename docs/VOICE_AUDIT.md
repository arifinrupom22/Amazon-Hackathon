# Voice reliability audit

_Date: 23 October 2026. Scope: the existing HomePilot AI web client, Express/MCP
server, Gemma adapter, plan workflow and voice layer._

## Executive summary

The reported error —

> “Speech recognition is offline. This browser's speech service needs a network
> connection. Check your connection, or type the request instead.”

— was **not evidence that the user was offline**. It was a hard-coded UI
translation of the Web Speech API's generic `network` error event. The browser
does not report *why* its recognition service failed; the old copy asserted a
cause the API never provided. The same session could browse the internet
normally and still receive this message.

The voice layer also had no alternative path when the browser's recognition
backend was unreachable, and no bounded retry. This is now fixed with honest
error copy, one automatic retry, an explicit Google transcription fallback, and
push-to-talk/hands-free state fixes.

## What was inspected

- `web/src/lib/voice/recognition.ts` — browser recognition wrapper and error
  mapping.
- `web/src/hooks/useVoiceInput.ts` — microphone/session lifecycle.
- `web/src/components/AssistantComposer.tsx` — composer states and submission.
- `web/src/hooks/useSpeechOutput.ts`, `web/src/lib/voice/synthesis.ts` — TTS.
- `server/src/services/ai/*` — Gemma adapter, failure classification, fallback.
- `server/src/services/planner.ts` — validation, approval, MCP execution.
- `server/src/mcp/tooldefs.ts`, `server/src/mcp/server.ts` — real MCP tools and
  Streamable HTTP handler (20 tools before this change).
- `server/src/http/app.ts`, `server/src/config.ts` — routes, security, env.
- `server/test/*`, `web/src/**/*.test.*` — existing coverage (116 tests before
  this pass).

## Root cause of the “offline” message

`describeRecognitionError` mapped every `SpeechRecognitionErrorEvent` with
`error === "network"` to a fixed “offline” title and message. The Web Speech
specification defines `network` only as “network communication required to
complete recognition failed”. It does not identify:

- the user's general connectivity;
- a browser speech-service outage;
- a firewall, VPN, proxy or DNS filter;
- an enterprise policy or unavailable regional service;
- an unsupported language (normally `language-not-supported`, but
  implementations vary);
- a Chromium build without a working proprietary speech backend.

Chrome's traditional implementation sends audio to a server-side speech service
(MDN; Chromium speech engine); Edge documents an Azure-backed service. Both can
fail independently of ordinary browsing. Firefox does not implement
`SpeechRecognition` at all.

Therefore replacing only the wording is necessary but not sufficient: the user
needs a real alternative.

## Contributing issues found

1. **No fallback when the browser service failed.** Manual typing existed, but
   there was no server-side transcription option.
2. **No retry policy.** A transient failure simply stopped; the retry button
   started a fresh session with no distinction between recoverable and
   non-recoverable errors.
3. **Bengali was offered without a verified backend.** `bn-BD` was passed to the
   browser; support depends on the engine and can fail as
   `language-not-supported` or, in some builds, `network`. The UI now says this
   explicitly and does not request continuous cloud audio for Bengali.
4. **One state race.** Pressing Stop while the permission prompt was open could
   re-enter “Listening” when the recognizer finally started. Fixed with a
   `stopping` guard in `RecognitionSession`.
5. **Hands-free did not exist.** Push-to-talk was solid, but there was no
   turn-taking and no guarantee that the microphone was closed while the
   assistant spoke.

## Implemented fixes

| Problem | Fix |
| --- | --- |
| Misleading “offline” claim | Error copy now says the browser's speech service didn't answer, lists plausible causes, and explicitly says it does **not** mean the internet is offline. |
| Unbounded/failed recovery | Exactly **one** automatic retry after a network error, with a visible “retrying once” notice; the second failure shows recovery actions and never loops. |
| No alternative provider | `SpeechInputProvider` abstraction: browser recognizer, optional server-side Google transcription (`gemini-3.5-transcribe`), and always-available text input. |
| Audio privacy | Cloud recording is opt-in per session via the provider selector; it opens the mic only on press, keeps audio in memory, uploads once to this app's server, and the server deletes the temporary Google file after transcription. No audio is persisted by HomePilot. |
| Hands-free reliability | Explicit headphones toggle, auto-send after a review delay, microphone closed while thinking/speaking, resume only after speech ends, pause on Stop/Esc/tab hide/errors. |
| No wake word | Not implemented; documented honestly. Hands-free requires the tab to be open and visible. |
| Missing read-only commands | A conservative command router answers “today”, “schedule”, “groceries”, “what changed” and conflict checks through real MCP tools, and handles “cancel last plan” and “I bought X” without involving the model. |
| MCP audit gap | Added the real `get_action_history` tool (21 tools total) and used it for “what did you change?”. |
| Spoken approval risk | Voice never approves or applies a plan. Approval remains an explicit button action in the plan review screen. |

## What is still not claimed

- A **live** Gemma plan or Google transcription call was not verified in this
  environment because `GEMINI_API_KEY` in `.env` is empty. The adapters are
  covered with mocked HTTP tests and report configuration errors honestly.
- Real microphone speech recognition was not exercised by a human in an
  automated browser. The UI state machine, permission errors, retries and
  transcript editing are tested with mocked browser APIs.
- Bengali recognition and a Bengali TTS voice were not verified on this machine
  (no Bengali voice installed, no live recognizer session).
- Wake-word detection and spoken “yes” approval are intentionally absent.
- Undo is not implemented; destructive MCP tools still require `confirm: true`
  and plans cannot contain delete tools.

## Verification commands

```bash
npm run typecheck
npm test
npm run build
```

Manual voice check:

1. `npm run dev`, open `http://localhost:5173` in Chrome or Edge.
2. AI Assistant → press the mic, grant permission, speak.
3. With a browser `network` failure, confirm the notice does **not** say
   “offline”, the one retry runs, and the error offers “Use Google
   transcription” only if it is configured.
4. Add `GEMINI_API_KEY` and `GOOGLE_TRANSCRIPTION_MODEL` to `.env`, restart,
   select **Google transcription**, press the mic, speak, press stop, and verify
   the transcript is editable.
5. Turn on headphones, speak, and confirm the mic is off while the answer is
   spoken and resumes afterwards.
