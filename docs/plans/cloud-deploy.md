# Cloud deploy — game + MCPs on Vercel, hub + TrueForge on Railway

Refs #14. Goal: anyone can play the full game — multiplayer city, thinking
NPCs, live MCP tools — from a public URL, reproducible in two clicks.

## Why this split (researched 2026-08-29, sources in issue/PR)

- **Vercel** now terminates WebSockets (beta) but has no always-on process:
  sockets die at maxDuration (5 min Hobby), instances share nothing, crons are
  1/day on Hobby. The hub is a 10 Hz sim with interval ingestors and in-memory
  world state — re-architecting it onto Redis + function-held sockets is a
  1–2 day risk we are not taking on submission day.
- **TrueForge cannot run on Vercel at all**: single long-running Node process,
  SQLite file (standalone) or Postgres+Redis (hosted), turns outlive requests.
  Blessed paths are npx-on-a-host or Docker. Standalone mode has **no auth and
  ignores OIDC** → it must never get a public URL.
- **Our MCP servers are Vercel's reference shape** (`vercel-labs/express-mcp`:
  Express + stateless Streamable HTTP, fresh server per request). They deploy
  as functions nearly unchanged; tool calls (5–20 s) fit the 300 s default.

## Architecture

```
player ─► https://sf-quest.vercel.app        (Vercel project, deploy button)
            ├─ game/dist static build (+ PlayroomKit SaaS multiplayer)
            └─ /api/mcp/sf-guide · /api/mcp/wall-street   (stateless functions)
                    ▲ called over HTTPS by ↓
game WS ─► wss://<world>.up.railway.app/ws   (Railway service "world")
            one container, one volume (/data):
            ├─ trueforge (localhost:8790 only — never public; SQLITE_PATH=/data)
            └─ hub (public $PORT; TRUEFORGE_BASE_URL=http://localhost:8790)
```

Running hub + TrueForge in ONE container (not two Railway services) avoids
Railway private-networking IPv6 bind unknowns, halves the moving parts, and
keeps TrueForge unreachable from outside by construction. One restart cycles
both — acceptable for demo-ware.

## Changes

1. **MCP export split** — `mcp/*/src/server.ts`: `export function buildServer`
   and guard `app.listen` behind `process.env.VERCEL`. Local `npm run dev`
   unchanged.
2. **Root Vercel glue** — `package.json` (deps mirroring the mcp packages),
   `vercel.json` (game build → `game/dist`, functions maxDuration 60),
   `api/mcp/sf-guide.ts` + `api/mcp/wall-street.ts`: fresh
   server+StreamableHTTPServerTransport per request, 405 on GET/DELETE.
   `mcp/mark` joins as a third file when it merges.
3. **Railway runner** — `deploy/world/Dockerfile` (node:22-slim; installs hub
   deps + `@truefoundry/trueforge@0.1.4` globally) + `start.sh` (trueforge on
   :8790 with SQLITE_PATH=/data/db.sqlite, wait for health, exec hub on $PORT;
   `.trueforge-sessions.json` symlinked into /data so NPC memory survives
   redeploys). `railway.toml`: dockerfile builder + `/api/health` healthcheck.
4. **TrueForge seed** — `hub/src/seed.ts`, called on hub boot, fail-soft,
   idempotent PUTs to the TrueForge settings API:
   - `OPENAI_API_KEY` set → PUT model provider `openai` with the same five
     models the dev instance runs (gpt-5-4-mini … gpt-5-6-*).
   - `GAME_ORIGIN` set → PUT mcp-servers `sf-guide`/`wall-street` pointing at
     `$GAME_ORIGIN/api/mcp/<name>`.
   - `TAVILY_API_KEY` set → PUT `tavily` (header auth) for NPC web search.
   No env → no-op, local dev untouched.
5. **Wiring** — Vercel env `VITE_HUB_WS=wss://<railway-domain>/ws` baked into
   the hosted build; `?hub=` runtime override still wins.
6. **README** — "Play it hosted / deploy your own" section: Vercel Deploy
   Button (no env vars needed) + Railway CLI steps + the two post-deploy keys.

## Verification

- `npm --prefix hub run typecheck` · `npm --prefix game run build`.
- Vercel preview: JSON-RPC `initialize` + `tools/list` + one `tools/call`
  against both `/api/mcp/*` endpoints; then promote to prod.
- Railway: `/api/health` green, logs show seed PUTs + agent registration;
  hosted TrueForge lists both Vercel MCP servers as reachable.
- Browser smoke on the prod URL with a private `?room=` — welcome frame, NPCs
  moving, weather chip live; NPC dialogue = canned lines until the user drops
  `OPENAI_API_KEY` into Railway (documented one-liner).

## Known limitations / follow-ups

- Model + Tavily keys are user-supplied post-deploy (never committed).
- `mcp/mark` lands as a follow-up route when its branch merges.
- A public Railway *template* (true one-click for strangers) needs dashboard
  work — documented CLI path ships now.
- Sim sleeps if Railway restarts; world state is in-memory by design.
