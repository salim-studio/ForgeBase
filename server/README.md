# ForgeBase server — real backend

REST + WebSocket realtime + JWT/API-key auth · SQLite (default) or Postgres ·
disk uploads (S3-compatible shape) · sandboxed function runner · server-side AI proxy.
Serves the web UI statically from the repo root (same origin).

## Quick start

```powershell
cd server
npm install
copy .env.example .env   # then set JWT_SECRET
node server.js           # → http://localhost:8080
```

Open the URL, go to **Project Settings → Cloud connection**, register
(first account becomes server admin), and the whole dashboard switches
from `LOCAL` emulator to `CLOUD`. Token lives in `sessionStorage`.

Docker:

```powershell
# from forgebase/ root:
docker build -f server/Dockerfile -t forgebase .
docker run -p 8080:8080 -v forge-data:/data -e JWT_SECRET=... forgebase
# or: docker compose -f server/docker-compose.yml up --build
```

## API (all JSON, `Authorization: Bearer <jwt>` or `x-api-key: fb_live_*`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | no auth |
| POST | `/api/auth/register` | first user → admin; bcrypt hash |
| POST | `/api/auth/login` | → `{token, user}` JWT |
| GET | `/api/me` | |
| GET/PUT/DELETE | `/api/users/:id` | PUT/DELETE admin only |
| GET/POST | `/api/projects`, `/api/projects/:id/users` | |
| PATCH/DELETE | `/api/projects/:pid` | owner/admin for delete |
| POST | `/api/projects/:pid/duplicate` | deep copy docs/functions/rules/kv |
| GET | `/api/projects/:pid/snapshot` | whole dashboard state in one call |
| GET/PUT | `/api/projects/:pid/kv/:key` | agents, code files, sites… (`providerCfg.key` never stored from browser) |
| GET/POST/DELETE | `/api/projects/:pid/collections…` + `/docs` CRUD | search/sort/paginate |
| GET | `/api/projects/:pid/backup` | full JSON dump |
| POST | `/api/projects/:pid/restore` | |
| GET/PUT/DELETE | `/api/projects/:pid/realtime?path=` | dot-path JSON |
| POST/GET/PATCH/DELETE | `/api/projects/:pid/files…` | multipart upload; private files need token; `POST …/files/mkdir` |
| GET | `/api/projects/:pid/files/:fid/download` | `?token=` accepted for previews |
| POST | `/api/projects/:pid/deploy` | multipart folder → public `/pub/:pid/:dep/…` |
| GET/POST/PUT/DELETE | `/api/projects/:pid/functions…` + `POST …/:fid/run` | `node:vm` sandbox, 5s compile / 10s run cap |
| GET/PUT | `/api/projects/:pid/rules` | `{deploy:true}` publishes; validated |
| POST | `/api/projects/:pid/rules/simulate` | allow/deny + reasons |
| GET/POST/DELETE | `/api/projects/:pid/keys` | secret returned **once**, sha256 stored |
| GET/POST/DELETE | `/api/projects/:pid/logs`, `GET …/metrics` | 30-day series |
| POST | `/api/ai/chat` | server-side key proxy (`AI_API_KEY`); 501 if unset |
| WS | `/ws?token=&project=` | pushes `{type:'invalidate'|'rt'|…}` on every mutation |

## Env

See `.env.example`. Production checklist: strong `JWT_SECRET`,
`DATABASE_URL` (Postgres) or persisted SQLite volume, `AI_API_KEY`
server-side only, reverse proxy with TLS in front, `CORS_ORIGIN` locked.

## Security notes

- Passwords: bcrypt (10 rounds). Sessions: signed JWT, expiry.
- API keys: random 144-bit, sha256-hashed at rest, shown once.
- Functions: untrusted code runs in `node:vm` with timeouts, no `require`/`process`.
- Auth endpoints + AI proxy are rate-limited per IP.
- Private files require a member token; public release previews are open (like real hosting).
