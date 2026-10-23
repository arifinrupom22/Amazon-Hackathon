# HomePilot AI — Submission Video Script

A shot-by-shot, timed script for recording your submission video. It is built directly on what
separated **winners** of recent Amazon/AWS and MCP hackathons from the rest of the field:

- **Strongest evidence in the first 30 seconds** — judges skim; lead with the working agent.
- **~30% problem / ~70% working solution** — show the agent *doing* the task, not slides.
- One **complete, end-to-end task** with a visible real-world result.
- One **multi-turn moment** that proves the agent tracks context and recovers.
- One **real personalization** moment (household context changes the answer).
- One **measurable technical proof** (the on-screen plan latency + live MCP JSON-RPC traffic).
- An **honest** close (real limitations, no fake integrations, no "Alexa+" claim).

Target runtime: **2:45–3:00.** Record at 1440×900 or 1920×1080, browser zoom 100%, captions on.
Setup: `npm run dev`, open <http://localhost:5173>, click **Reset sample data** so you start clean.
For a live model set `AI_PROVIDER=google` + `GEMINI_API_KEY`; on the local planner the script is
identical and never claims a model was used when it wasn't.

---

## Scene 1 — 0:00–0:25 · The hook + strongest evidence FIRST

**VISUAL:** Start already *inside* the product* — no logo splash. Open on the **AI Assistant** screen
mid-conversation: a plan card visible with its latency, the **MCP traffic** panel ticking real
JSON-RPC calls. Cut fast to the Overview showing `MCP connected · 21 tools`.

**ON-SCREEN TEXT (top-left, appears at 0:02):**
> HomePilot AI — a household agent that only acts after you approve. Real MCP server. 21 tools.

**NARRATION (V.O.):**
> "This is HomePilot AI. I speak a household request, it becomes a structured plan of real tool
> calls — and **nothing is written to my database until I approve it.** Behind it is a real Model
> Context Protocol server: twenty-one schema-validated tools, and this panel is the actual JSON-RPC
> traffic, not a mockup."

**PRO TIP:** This is the 30-second judge test — a working agent + the live MCP panel + the
"approval-gated" thesis, all before you explain anything.

---

## Scene 2 — 0:25–0:50 · The problem (keep it to ~20% of the video)

**VISUAL:** Talking head, or a single clean title card. Optional B-roll of a messy group chat /
sticky notes / a calendar with a double-booking.

**NARRATION (V.O.):**
> "Running a home is a hundred small decisions — what to buy, who's picking up the kid, when the
> bathroom gets cleaned. Chat assistants can *talk* about it. They can't safely *change* anything —
> and if you hand an autonomous agent your household data, one wrong action is a deleted event or a
> double-booked appointment. HomePilot fixes the trust problem, not just the convenience problem."

**ON-SCREEN TEXT:**
> Problem: assistants talk, they don't act — and acting unsafely is worse than not acting.

---

## Scene 3 — 0:50–1:25 · A real spoken request → structured plan (end-to-end #1)

**VISUAL:** Push the mic. Speak clearly (or use a suggestion chip). Show the **live transcript**
streaming into the composer. **Pause to edit the transcript** (proves it's editable). Send. The
plan card appears — **zoom slightly on the latency badge** (e.g. `1.2s`). Open **Plan Review**.

**SAY (on camera or V.O.):**
> "Add oat milk and sourdough to the grocery list, and remind me to call the plumber at 5 PM tomorrow."

**NARRATION (V.O.):**
> "That's my real voice. The transcript is live and editable before anything runs. The server turns
> it into a **structured plan** — every row is a real MCP tool with validated arguments. And notice
> the timing badge: that's the measured round-trip to produce this plan, right there on the card."

**ON-SCREEN TEXT:**
> Voice → editable transcript → schema-validated plan · measured latency shown live

---

## Scene 4 — 1:25–1:55 · Review, edit, and a REAL safety check (the differentiator)

**VISUAL:** On **Plan Review**: point at **"Staging mode — nothing has been written yet."** Toggle one
action off, then on. **Edit** the plumber reminder time. Trigger or point at a **conflict / sanity
warning**. Highlight the tool names on the rows (`add_grocery_item`, `create_task`).

**NARRATION (V.O.):**
> "Nothing is written yet — this is a staging area. I can toggle individual actions off, edit the
> details, and the server re-validates everything against the real tool schemas *before* I can
> approve. It even flags conflicts. This cite-before-act gate is the same human-approval pattern that
> won Best Overall at the MCP birthday hackathon — the model proposes, a human decides, only then do
> the tools run."

**ON-SCREEN TEXT:**
> Model proposes → schema validation → conflict check → HUMAN approves → tools run

---

## Scene 5 — 1:55–2:20 · Approve → real execution → persistence (end-to-end result)

**VISUAL:** Click **Approve & apply**. Show the **server's per-action execution report** (not a toast).
Open **Groceries** and **My Tasks** — point at the new records' **`from plan`** badge. **Reload the
page** — the records are still there.

**NARRATION (V.O.):**
> "I approve. This is the server's own per-action report, naming the tool that ran each action. Here
> are the new groceries, with a 'from plan' provenance badge — and if I reload, they're still here.
> That's SQLite, not React state. And if I ask 'what did you just change?' it answers from the real
> action history."

**MULTI-TURN BEAT (do this live):** Type/say **"What did you just change?"** → it reads the real
audit log. Then **"I already bought the oat milk."** → it marks that item purchased via a real tool.
> *(This is the multi-turn + context + reversible-action proof judges look for.)*

---

## Scene 6 — 2:20–2:40 · Real personalization (the "it knows my home" beat)

**VISUAL:** The **Household context** panel (members, diet, quiet hours, cleaning day, store). Then a
plan that visibly *uses* it — e.g. the "relaxed Saturday" plan respecting the vegetarian diet and the
Saturday-afternoon cleaning day.

**NARRATION (V.O.):**
> "Every request is personalized with my real household context — these members, this vegetarian diet,
> this quiet-hours window. The plan respects all of it. That's context the agent actually uses, not a
> settings page that does nothing."

**ON-SCREEN TEXT:**
> Personalization from real context — not the word "personalized"

---

## Scene 7 — 2:40–2:55 · Honesty & resilience (builds trust fast)

**VISUAL:** Household & Memory → **Resilience test** → **Simulate quota exhaustion**. The exact banner
appears: **"API credits exhausted. Demo mode is now active."** Show the plan still reviewable and
executable on the local planner. Point out the banner is dismissible and marked simulated.

**NARRATION (V.O.):**
> "When the model provider is out of quota, HomePilot doesn't die — a deterministic local planner
> takes over, uses the same real tools, and says so honestly. And a TTS or speech failure never
> blocks the typed fallback. No fake success, ever."

**ON-SCREEN TEXT:**
> Deterministic fallback · honest errors · the exact quota message, only when it's real

---

## Scene 8 — 2:55–3:05 · Close + architecture + call to action

**VISUAL:** Quick architecture strip: `Voice → MCP planner (21 tools) → validate → approve → SQLite`.
End card with repo URL, `npm install && npm run dev`, and "149 tests passing."

**NARRATION (V.O.):**
> "HomePilot AI: conversational planning, transparent approval, real actions over a real MCP server.
> Self-hosted, SQLite-backed, 149 passing tests, and honest about which parts are model-driven. Built
> independently — no Alexa integration claimed. Try it: clone, install, run."

**ON-SCREEN TEXT:**
> HomePilot AI · voice-first · approval-gated · real MCP · self-hosted
> github.com/\<you\>/homepilot-ai · npm install && npm run dev

---

## Quick feature montage (optional B-roll to cut in)

If you have extra seconds, splice these 1–2 s clips under the narration to show breadth fast:
- Animated **waveform** while listening + the persistent **hands-free** mic indicator.
- **Read aloud** button speaking an answer; **Stop reading**.
- Voice-language switch **English ⇄ বাংলা**.
- **MCP traffic** panel streaming `initialize`, `tools/list`, `tools/call`.
- **Action timeline** showing proposed → succeeded.
- **Reset sample data** button (demo-workspace honesty).

---

## Recording checklist

- [ ] Reset sample data first; no leftover `from plan` records from rehearsal
- [ ] Sidebar shows `MCP connected · 21 tools`
- [ ] The latency badge on a plan card is visible and legible
- [ ] At least one **live multi-turn** follow-up ("what did you change?" / "I already bought…")
- [ ] Browser zoom 100%, no bookmarks bar, no notifications, no real API key on screen
- [ ] Microphone tested; captions burned in or provided as a separate .srt
- [ ] Final video ≤ 3:00, link pasted into README + Devpost

---

## What NOT to do (common ways strong projects lose)

- Don't open with a logo animation or a long architecture slide — **open inside the working app.**
- Don't read the whole screen aloud; narrate the *why*, let the visuals show the *what*.
- Don't claim a wake word, background listening, on-device STT, or Alexa+ — none are built.
- Don't show a fake success toast for an action that didn't run through a real MCP tool.
- Don't let the video run past 3:00; judges are scoring dozens.
