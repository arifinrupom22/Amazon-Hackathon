# HomePilot AI — Project Video Guide

A practical recording plan for a clear, honest hackathon submission video. Target length: **2:45–3:00**. The video should show the working app early, then follow one request all the way from proposal to a saved result.

## Before recording

### 1. Prepare a safe demo environment

- Use a **demo/test Neon database**, not a database containing personal or production records.
- Check `.env` has a working `DATABASE_URL`. For a live Gemini plan, set `AI_PROVIDER=google` and `GEMINI_API_KEY` too.
- If Gemini is unavailable, use `AI_PROVIDER=demo`. The app still works; say “local planner” when the UI identifies it that way.
- Start the app from the repository root with `npm run dev` and open <http://localhost:5173>.
- In **Household & Memory → Data & reset**, choose **Reset sample data** once before the take. **This clears the demo database's household records**, so do this only on the demo/test database.

### 2. Set up the screen and audio

- Use Chrome or Edge if you want to demonstrate browser voice input. Grant microphone permission and test the mic before recording.
- If voice recognition is unavailable or unreliable, type the same request. Do not describe a typed take as spoken input.
- Set browser zoom to 100%. Use a 1440p or 1080p screen, close unrelated tabs, hide bookmarks, silence notifications, and keep API keys and `.env` off-screen.
- Use a microphone or headset. If you demonstrate spoken replies, wear headphones to prevent echo.
- Enable captions or add subtitles during editing. Keep UI text large enough to read.
- Record a few seconds of room tone and do one short rehearsal before the final take.

### 3. Rehearse the request

Use this tested sample request in the Assistant:

> Plan our weekend. We need groceries for two people, a cleaning session on Saturday, and a reminder to prepare dinner before 7 PM.

It should produce grocery, schedule, and task actions for review. The exact dates depend on the current date and household timezone. Read the plan card before describing which provider generated it.

## Timed video script

### 0:00–0:15 — Open on the product

**Show:** Start inside HomePilot, with the Overview or Assistant open. Keep the live MCP traffic panel visible if space allows. Briefly show `MCP connected · 21 tools`.

**Say:**

> “HomePilot AI helps coordinate a household. I describe what needs doing, review a proposed plan, and approve it before the server changes anything.”

**On-screen title:** `HomePilot AI · Plan → Review → Approve`

### 0:15–0:32 — Explain the problem

**Show:** A quick view of Tasks, Schedule, and Groceries, then return to Assistant.

**Say:**

> “Household plans are spread across reminders, calendars, and grocery lists. A chat response alone does not update them safely. HomePilot brings those actions together behind a review step.”

### 0:32–1:05 — Make a request

**Show:** Open Assistant. Speak the sample request above, or type it. If speaking, show the editable transcript before sending. Submit the request and show the resulting plan card.

**Say:**

> “I can speak or type. Here the request is [a live Gemini response / the local planner]. The server turns it into specific household actions, and shows the assumptions before I approve anything.”

Choose only the accurate provider description. If Gemini fails and the app falls back, say the local planner took over; do not present the fallback plan as a Gemini result.

### 1:05–1:35 — Review the plan

**Show:** Open the plan review. Point to the staged status, assumptions, warnings, and MCP tool names. Toggle one action off and back on. If a time field is available, edit it and save the edit.

**Say:**

> “This is still a proposal. I can inspect the tool calls, change details, or disable an action. The server validates the stored plan and checks schedule conflicts before execution.”

Do not invent a conflict. If this plan has no conflict, show the warnings or assumptions that are actually present.

### 1:35–2:02 — Approve and show the saved result

**Show:** Click **Approve & apply**. Let the per-action execution report appear. Open Groceries, Tasks, or Schedule to show the resulting items and their `from plan` provenance. Reload once and show that the record remains.

**Say:**

> “Now I approve. The server reports each action and its result. The new items are in the household lists, and they remain after a reload because they are stored in PostgreSQL.”

### 2:02–2:25 — Show history and a follow-up action

**Show:** In Assistant, ask **“What did you just change?”** Then say or type **“I already bought sparkling water.”** Show the activity/history response and the grocery purchase state update.

**Say:**

> “HomePilot can answer from its action history. A follow-up can also update an item through an MCP tool, and the interface shows the changed purchase state.”

If either phrase is not recognized in the rehearsal, skip it rather than showing a failed or misleading result.

### 2:25–2:42 — Show provider resilience honestly

**Show:** Open **Household & Memory → Resilience test → Simulate quota exhaustion**. Show the message: **“API credits exhausted. Demo mode is now active.”** Point out that the UI labels this as simulated. Discard the resulting proposal.

**Say:**

> “This control simulates one quota failure; it does not make a provider request or consume credits. The app labels the simulation and keeps the proposal workflow available.”

This is a simulation. Do not describe it as a real Gemini quota event.

### 2:42–2:58 — Close with the architecture and call to action

**Show:** Return to the Overview, then use a simple end card with the repository URL and `npm install` / `npm run dev`.

**Say:**

> “HomePilot combines a React app, a Node server, 21 MCP tools, and persistent PostgreSQL storage. Its approval flow keeps household changes reviewable. The project and setup guide are on GitHub.”

**End card:** `GitHub: [your repository URL]` · `React + TypeScript · MCP · PostgreSQL`

## Editing notes

- Keep the full walkthrough under three minutes. Cut pauses, loading time, and repeated navigation.
- Add subtitles for narration and keep important UI labels visible long enough to read.
- Use brief zooms for the staged status, tool names, action report, and PostgreSQL-backed result.
- Do not show `.env`, API keys, database credentials, private browser profiles, or personal data.
- Do not claim Alexa+ integration, always-on listening, a real quota failure, or a live Gemini result when the UI says otherwise.
- Add the published video URL to the README and the submission form after upload. Test the link in a signed-out/private browser window.

## Final recording checklist

- [ ] Demo/test database selected; reset performed only on that database
- [ ] App opens and MCP status shows the connected tools
- [ ] Microphone tested, or typed input chosen for the take
- [ ] Provider shown in the UI matches the narration
- [ ] Plan remains unapproved until the review is shown
- [ ] Approval report and persisted item are visible
- [ ] Quota test is described as simulated
- [ ] No secrets or personal data appear on screen
- [ ] Captions are readable; narration is clear
- [ ] Final cut is no longer than 3:00
- [ ] Video link works and is added to README/submission form
