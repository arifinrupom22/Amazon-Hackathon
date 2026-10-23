# Publishing & submission checklist

Everything here is a manual step you perform. The repository contains no credentials, no deployment
URLs and no claims of a live Amazon/Alexa+ integration.

## 1. Pre-flight (10 minutes)

Run from the repository root:

```bash
npm install
npm test                 # 149 tests, 17 files (59 server + 90 web)
npm run typecheck
npm run build
```

Then audit for secrets and junk:

```bash
git status --short
git check-ignore -v .env server/.env server/data/homepilot.db
grep -RIn --exclude-dir=node_modules --exclude-dir=.git \
  -E "(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{30,}|GEMINI_API_KEY=.+)" .
```

Expected: only `.env.example` placeholders match, and `git status` shows no `.env`, no database file,
no `node_modules`, no `.freebuff/shots` or `.freebuff/screenshot.mjs`.

Add these to `.gitignore` if they are missing:

```
.env
server/.env
server/data/
.freebuff/
node_modules/
dist/
```

Confirm the screenshots you want are committed (`docs/screenshots/*.png`) and that every image
referenced by the README exists.

## 2. Initialize and commit

```bash
git init
git add .gitignore .env.example package.json package-lock.json README.md
git add server web docs Design
git status                 # review the file list before committing
git commit -m "$(cat <<'EOF'
HomePilot AI: household planning with a real MCP Streamable HTTP server

Adds a React client that plans, reviews and applies household changes through
21 schema-validated MCP tools, with SQLite persistence, a Gemma 4 provider
adapter, classified provider fallback and end-to-end tests.
EOF
)"
git branch -M main
```

Do **not** run `git add -A` in a checkout that contains other work: review the list. If Git reports
that `Design/` is large, it is intentional — the folder is the visual reference for the UI.

## 3. Create the GitHub repository (manual)

1. Go to <https://github.com/new>.
2. Repository name: `homepilot-ai`. Visibility: public. Do **not** initialize with a README,
   `.gitignore` or license — the repository already has them.
3. Add the remote and push:

```bash
git remote add origin https://github.com/<your-username>/homepilot-ai.git
git push -u origin main
```

If you use the GitHub CLI and are signed in:

```bash
gh repo create homepilot-ai --public --source=. --remote=origin --push
```

4. Repository settings:
   - **Description:** `Household coordination with human-approved plans over a real MCP Streamable HTTP server.`
   - **Topics:** `mcp`, `model-context-protocol`, `typescript`, `react`, `sqlite`, `gemma`, `ai-agents`
   - **License:** MIT (file already present).
   - **Website:** leave empty unless you deploy (see §6).

## 4. Release and assets

1. Tag the submission: `git tag -a v1.0.0 -m "Hackathon submission" && git push origin v1.0.0`.
2. Create a GitHub Release from the tag and paste the demo video link.
3. Upload the video to YouTube (unlisted is fine) or Vimeo; keep it ≤ 3:00 and public/unlisted —
   not private, or judges cannot watch it.
4. Record following [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md). Do not show a real API key on screen.

## 5. README truth check

Before you call it done, verify each sentence in the README against reality:

- [ ] Setup commands work from a clean clone on a machine without your `.env`.
- [ ] The MCP endpoint path is `/mcp` and the port defaults are correct.
- [ ] Tool list matches `tools/list` (21 tools).
- [ ] Test count matches the actual output of `npm test`.
- [ ] Screenshots match the current UI (no removed badges, no old colours).
- [ ] Model names are the ids Google actually serves (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`) or
      explicitly marked as examples.
- [ ] No claim of Alexa+ registration, deployment or real billing-quota consumption.
- [ ] The “Known limitations” section is honest and still accurate.

## 6. Deployment (optional)

The judged demo runs locally, which is the recommended path. If you do host it:

- **Single process:** `npm run build && npm start` serves the UI, REST API and `/mcp` on `:8787`.
  This is compatible with the MCP transport because the same origin serves everything.
- **Do not deploy only the web build.** The client needs `/mcp` on the same origin (or a configured
  `VITE_API_BASE` plus matching `CORS_ORIGINS`); a static host alone cannot run the server.
- **Before exposing it:** add authentication and per-user scoping, set `HOST=0.0.0.0`, terminate TLS
  at a reverse proxy, restrict `CORS_ORIGINS`, and treat the MCP endpoint as an authenticated API.
  The current app is intentionally localhost-only and has **no auth**.
- **SQLite:** mount a persistent volume for `server/data/`. One process only.

If you deploy, replace the placeholder in the README with the tested URL **only after** clicking
through it yourself. Do not invent a URL.

## 7. Devpost submission

Prepare these fields from the README (do not paste secrets):

| Field | Value |
| --- | --- |
| Project name | HomePilot AI |
| Tagline | Less household chaos. More time for life. |
| Track | Alexa+ (self-hosted MCP experience, web demonstration client) |
| Video | your ≤3:00 link |
| Repository | your GitHub URL |
| Built with | TypeScript, Node.js, Express 5, React, Vite, Tailwind CSS, official MCP TypeScript SDK, Streamable HTTP, SQLite (`node:sqlite`), Zod, Vitest, Google AI Studio / Gemini API (Gemma 4), Ollama |
| Try it | `npm install && npm run dev` → <http://localhost:5173>, MCP at `/mcp` |

Description outline:

1. Problem: household coordination, assistants that cannot safely act.
2. What it does: plan → review/edit → approve → execute through real MCP tools → persisted.
3. Why MCP: all reads/writes go through 21 schema-validated tools; the web app is one client.
4. AI: Gemma 4 through Google AI Studio (configurable), local planner fallback, classified errors,
   exact quota notification, controlled test.
5. Verification: 149 tests, JSON-RPC protocol tests, curl/Inspector instructions.
6. Honesty: not connected to Alexa+ or Amazon preview tooling.

## 8. Final submission checklist

- [ ] Public GitHub repo, default branch `main`, no secrets in history
- [ ] `npm install`, `npm test`, `npm run build` pass on a clean clone
- [ ] README screenshots and demo video link present
- [ ] Demo video ≤ 3:00, audio audible, no keys visible
- [ ] MCP endpoint verified with `curl` and MCP Inspector
- [ ] Fallback notification demonstrated (simulated, labelled)
- [ ] Devpost fields filled and submitted before the deadline
- [ ] Keep the local demo environment intact until judging ends
