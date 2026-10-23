# HomePilot AI — demo script (under 3 minutes)

Target length: **2:50**. Record at 1440×900 with browser zoom 100%.
Before recording: `npm run dev`, open <http://localhost:5173>, and reset sample data on
Household & Memory so the run starts from the seeded state.

For a live Gemma plan, set `AI_PROVIDER=google` and `GEMINI_API_KEY` before starting. The same script
works with the deterministic planner; say which one answered. Do not claim a live model if the plan
card says it came from the local planner.

Turn on **Speak answers automatically** before the first spoken request (or press **Read aloud** on
the answer). Use headphones while recording so HomePilot's own voice is captured cleanly and does not
re-enter the microphone.

---

## 0:00–0:20 — Hook

Show the Overview dashboard. Point at `MCP connected · 21 tools`.

> "HomePilot AI is a voice-first household agent built on a real Model Context Protocol server. You
> speak, it proposes a structured plan, you approve it, and only then does the server run real tools
> against SQLite. No fake actions, no permanent demo mode."

## 0:20–0:55 — A real spoken request

Open **AI Assistant**. Press the microphone, allow access, and say:

> "Plan a relaxed Saturday for two. Add groceries for dinner, schedule cleaning in the afternoon,
> and remind me to prepare dinner before 7 PM."

Stop listening. Show:

- the live transcript / **Speech recognized** state;
- the editable text before it was sent (mention it, then send);
- the structured plan and assumptions;
- **Review the proposed plan**.

> "The transcript is editable before anything happens. Voice uses exactly the same proposal pipeline
> as typing — no second chatbot and no shortcut around approval."

## 0:55–1:30 — Review, conflicts and approval

On **Plan Review**:

1. Point at **Staging mode. Nothing has been written yet.**
2. Point at assumptions and at least one conflict/sanity check.
3. Toggle one action off and on. Edit one time and click **Done**.
4. Point at the tool name on each row.

> "The model only produced JSON. The server validated every action against the real MCP tool schema,
> detected conflicts, and stored the plan as a proposal."

Click **Approve & apply**. The next screen is the server's execution report, not a toast.

> "Every line is the MCP tool that actually ran, with its own result."

Open **My Tasks**, **Schedule** or **Groceries** to show the new records with a `from plan` badge.
Reload once: "Still there — SQLite, not React state."

## 1:30–1:55 — Read-only commands and a real action

Return to Assistant. Enable **Speak answers automatically** if it is off.

Type or say: **"What do I need to do today?"**

> "This did not create a plan. It called `get_household_summary` over MCP and answered directly, and
> you can see the call in the MCP traffic panel."

Then say: **"I already bought sparkling water."**

> "A conservative intent router resolved one grocery item and called
> `mark_grocery_item_purchased` — a real, reversible MCP mutation. Ambiguous matches get a question,
> not a guess."

Optional if time: press the headphones button and say **"What's on my schedule?"**. Point out that
the microphone closes while the answer is spoken and reopens afterwards. Do not wait for a second
turn if the recording is tight.

## 1:55–2:25 — Controlled quota fallback

Household & Memory → **Resilience test** → **Simulate quota exhaustion**.

> "This arms exactly one request to behave like a 429 RESOURCE_EXHAUSTED response. It makes no
> provider call and uses no credits."

Send a request from Assistant. The response shows, verbatim:

> **API credits exhausted. Demo mode is now active.**

> "The notice is dismissible and marked simulated. The deterministic planner still stages a
> reviewable plan, and approval still runs the real MCP tools. A bad model day does not take the
> household down."

Discard that plan rather than approving it.

## 2:25–2:50 — Close

> "Voice is browser-native — no paid speech API — with an optional Google transcription fallback for
> when the browser service fails. The 'offline' message is fixed: it was a misdiagnosis, not a
> network test. Everything runs over a self-hosted MCP server with approval, validation,
> persistence, and 149 tests. The repo has the audit, setup and tool list."

End card: repository URL + `npm install && npm run dev`.

---

## Recording checklist

- [ ] Clean reset done; no leftover `from plan` records from rehearsal
- [ ] Sidebar shows `MCP connected · 21 tools`
- [ ] Microphone permission granted **before** recording (avoid a permission prompt on camera)
- [ ] Auto-speak on; headphones used; no echo or feedback
- [ ] Browser zoom 100%, no bookmarks bar, no notifications
- [ ] Terminal font ≥ 16 px if showing `curl`
- [ ] No API key visible on screen, in `.env` tabs, or in network panels
- [ ] If the live key is absent, say "local planner" when the plan card says so
- [ ] Final video ≤ 3:00, uploaded, link pasted into the README and Devpost
