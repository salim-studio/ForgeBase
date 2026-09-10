# ForgeBase — browser-based Firebase-like development platform

**Local-first · Arabic/English · dark/light · AI-native**

Open `index.html` directly in a browser (no build step, no dependencies).
All services run on **local emulators** (IndexedDB + LocalStorage) and are
clearly labeled `LOCAL EMULATOR` vs `CLOUD`.

## What's inside

| Section | What works |
|---|---|
| Projects | create · open · duplicate · rename · archive · delete (typed-ID confirm) · selector · auto config + env vars |
| Overview | stats, canvas charts (requests/errors/users/db-ops), activity, deployments |
| App Builder | NL prompt → reviewable plan → generates schema + auth + rules + code + preview deploy |
| Database | Firestore-style collections/docs (CRUD, search, sort, paginate, JSON/CSV import, export, backup/restore) + Realtime JSON tree |
| Authentication | email/password emulator, roles (admin/user), providers flags, sessions, CSV export |
| Storage | IndexedDB blobs, folders, public/private flags, previews, local URLs, storage rules |
| Hosting | folder deploy, preview/prod environments, history + console, `forgebase.json`, simulated URLs |
| Functions | JS editor, env vars, sandboxed test runner with payload, deploy status |
| API & SDK | project config, revocable keys, REST catalog, snippets (JS/TS/Python/React) |
| Security Rules | editor, validator, templates, **permission simulator** (uid/role/path/op → ALLOW/DENY), approval-gated deploy |
| Users | directory, search, roles, status |
| AI Assistant | project-aware intents (collections, schemas, auth, rules, React, errors, deploy) + executable actions |
| AI Agents | library (database/coding/security/testing/deploy/data), custom agents (tools/permissions/max-steps/approval), timelines, 6-stage **workflows** |
| AI Providers | OpenAI / Gemini / Claude / Qwen / DeepSeek / custom OpenAI-compatible — BYO key (masked, local-only), test button |
| Code Editor | multi-file, highlighting preview, search-friendly, run JS, mini terminal, AI review |
| Analytics | 30-day charts + CSV export |
| Logs | service/level/text filters, status codes, JSON export |
| Extensions | toggles with event logging |
| Docs | per-service quickstart/config/examples/security + AI explanations |

## Power tools

- **Command palette** — `Ctrl+K`: navigate + run commands + natural language.
- **Command Center** — `` ` ``: `create project X` · `create collection users` · `create function hello` · `register a@b.c pass123` · `deploy` · `show logs` · `generate security rules` · `analyze database` · `run tests` · or plain NL like `"build auth with admin roles"`.
- **Global search** — `/`: collections, docs, files, users, functions, sections.
- **Safety** — deletes, prod rules, prod deploys, and dangerous agent actions require explicit human approval.

## Architecture (local ↔ cloud)

```
views.js (UI) → services.js (logic) → store adapter (IndexedDB today)
ai.js (assistant/agents/providers/commands/builder) → local engine or BYO provider
core.js (i18n/theme/router/state/logs)
```

Production swap path: `Backend: Node.js+TS · DB: Postgres/document · realtime: WebSocket ·
auth: JWT/OAuth · storage: S3-compatible · AI: provider proxy (/api/ai/*) · deploy: Docker`.
Views stay identical; only the store adapter changes.

## Data & privacy

- DB/Storage emulators: **IndexedDB** (`forgebase_v1`); prefs/small state: LocalStorage.
- AI provider keys: stored locally only, displayed masked, never committed; use env vars / backend proxy in production.
- Demo seed project (`demo-starter`) ships with users, products, logs, metrics, a function, and a deployment — delete it anytime.

## Run

Just open the file (or serve statically):

```powershell
# option A: double-click index.html
# option B:
npx serve forgebase
```
