# Quest Hero — Build Spec v2 (voxel world + live-data village)

> The canonical build spec. The [README](../README.md) is the pitch; this is what we actually build,
> in what order, and where the cut lines are. Companion doc: [API.md](API.md) — the World Hub
> contract the MCP team codes against.
>
> Hackathon: Agent Harness Hackathon, Bright Data SF, **2026-08-29, deadline 18:00 PDT**.

---

## 1. Vision

A small kawaii **voxel village (Ashford)** you explore in **third person**. It is *alive*: NPCs
walk routes, sit by the forge, feed the chickens; a cat chases butterflies; weather in the village
is **San Francisco's real weather right now**; the day/night lighting follows real local time.

Every NPC is a **TrueForge agent session**. Talk to one and it answers in a **kawaii speech
bubble** — and it knows *what is happening in the world right now*, both the game world (recent
events: "a crate just arrived", "it started raining") and the real one (via the MCP tools the
harness gives it). Real data doesn't just flavor dialogue — it **mutates the world**: news
headlines become quests on the notice board, GitHub commits to this repo spawn delivery crates
in the square, weather changes bring rain particles and NPCs hurrying under awnings.

All world state is centralized in one **World Hub** server and exposed over a documented HTTP/WS
API — that surface is what the team's MCP servers (`quest-hero-world`, `quest-hero-web`) wrap.

**Demo sentence for judges:** "Nothing in this village is scripted — the weather is real, the
quests are today's headlines, every character is a harness session with tools, and the whole
world is an MCP surface."

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ game/ — browser client (Vite + TS + Three.js)                        │
│   voxel island · third-person controller · rigged GLB characters     │
│   kawaii bubbles (DOM overlay) · weather FX · day/night lighting     │
└───────────────▲──────────────────────────────────────────────────────┘
                │ WebSocket /ws  (snapshot + deltas + bubbles + FX cues)
                │ REST for dialogue turns (hub proxies the stream)
┌───────────────┴──────────────────────────────────────────────────────┐
│ hub/ — World Hub server (Node 22 + TS, port 7777)  ← THE ONE STORE   │
│   • authoritative sim: NPC routines, animals, objects, quests, time  │
│   • append-only event log (everything that happens becomes an event) │
│   • real-data ingestors: Open-Meteo SF · HN headlines · GitHub repo  │
│   • dialogue broker: injects [WORLD NOW] context → TrueForge session │
│   • REST + SSE + WS — documented in docs/API.md                      │
└───────▲──────────────────────────────┬───────────────────────────────┘
        │ REST (read + write)          │ proxied turns (SSE stream)
┌───────┴────────────────┐   ┌─────────▼────────────────────────────────┐
│ MCP servers (teammates)│   │ TrueForge harness (localhost:8790)       │
│  quest-hero-world      │   │  one session per NPC (memory!)           │
│   = wraps hub REST     │──▶│  tools: Bright Data MCP + quest-hero-*   │
│  quest-hero-web        │   │  approvals gate world writes             │
│   = Bright Data        │   └──────────────────────────────────────────┘
└────────────────────────┘
```

**The load-bearing loop:** the hub feeds each NPC a live `[WORLD NOW]` digest every turn (weather,
time, recent events, active quests, who's nearby), and the NPC's harness tools (via the teammates'
`quest-hero-world` MCP, which wraps the hub's own REST API) let it *query deeper and act back on
the world* — spawn an object, start a quest, make it rain — behind TrueForge approval gates.
Agents read the world, agents write the world, and the game renders it.

**Why a hub now:** v1 kept world state in the browser (`game/src/state.ts`), where no MCP server
process can reach it. Moving state server-side is what makes "centralize all game data for MCP"
true, fixes browser→TrueForge CORS by proxying, and lets the world keep living while nobody's
looking at it.

### Ports
| Service | Port | Notes |
|---|---|---|
| World Hub | **7777** | REST + WS + SSE, CORS open (localhost hackathon mode) |
| Vite client | 5173 | `npm run dev` in `game/` |
| TrueForge | 8790 | `npx @truefoundry/trueforge@latest`; hub proxies it |

### Repo layout (after this spec lands)
```
game/                  # Vite client (upgraded in place — keep what works)
  src/                 #   main, world(voxel), player(3rd person), npc, bubbles, fx, net
  public/assets/models # generated GLBs land here (gitignore large? no — commit, they're ~1-5MB)
hub/                   # World Hub server + asset pipeline
  src/                 #   index(api+ws), state, sim/, ingest/, dialogue, events
  tools/tripo.ts       #   Tripo generation pipeline (npm run assets)
shared/protocol.ts     # types shared by game+hub (imported relatively by both)
docs/SPEC.md           # this file
docs/API.md            # hub API contract — the MCP team's source of truth
docs/trueforge/        # vendored harness docs (existing)
```

## 3. World design

48×48 tile island, one voxel = 1m cube, hand-authored as ASCII layout in `hub/src/sim/island.ts`
(single source: hub owns layout; client fetches it in the WS welcome snapshot and meshes it).

```
        ~ water    . grass    : path    # plaza stone    T tree    F flowers
   N            ┌────────────────────┐
   ▲            │  hill + shrine  T  │   POIs:
   │    forest  │ T T   :        F   │   • plaza: fountain, notice board (quests), lamp posts
   W──┼──E      │ T  ┌──────┐  farm  │   • forge: Bran's smithy + fire + anvil
   │            │ :  │plaza │  ▒▒▒   │   • market: Wren's stall + crates + maildrop
   S            │ :  │ ⛲ 📋 │  🐔    │   • farm: crops + chicken pen
        docks   │ ⚒  └──────┘  :     │   • docks: pier over water, boat
                │  :   :    :        │   • hill: tiny shrine, fireflies at night
                │ ~~~ pier ~~~~      │
                └────────────────────┘
```

- **Terrain**: 1–3 block height, grass/dirt/stone/sand/water tile types. Rendered as
  `InstancedMesh` per block type (≤ ~6 instanced draws for all terrain). Slight per-instance
  color jitter so grass doesn't read flat.
- **Props**: trees/lamps/fence/crates as cheap voxel clusters or Tripo GLBs (see §7). Every
  prop is an **object** in hub state with an id — so MCP writes can spawn/remove them live.
- **Walkability**: heightmap lookup, walk on top of blocks ≤1 step up, water blocked. No physics
  engine — kinematic controller + grid, that's it.

## 4. Client — the "super nice graphics" contract (game/)

Priority-ordered; everything above the cut line ships.

1. **Third-person controller**: character at center, spring-arm follow cam (yaw with mouse drag
   or auto-follow, wheel zoom 4–10m), WASD camera-relative movement, walk 3 m/s / run 6 m/s
   (Shift), snap-turn toward movement dir (lerped), step-up on 1-block ledges. `E` to talk keeps
   the existing proximity mechanic.
2. **Lighting rig**: `ACESFilmicToneMapping`, `outputColorSpace = SRGBColorSpace`, hemisphere +
   directional sun (2048 PCFSoft shadow map over the island), sun position + color driven by
   **real SF time** from hub (`time.phase`: dawn/day/dusk/night curves), matching fog + sky
   (gradient dome or `Sky` example), warm point lights on lamps/forge at night.
3. **Kawaii bubbles** (DOM overlay, §6): replaces the bottom dialogue box for NPC speech; input
   stays a restyled bottom bar.
4. **Weather FX**: rain (instanced streaks + puddle-dark ground tint), clouds overcast (dim sun,
   grey fog), fog weather (dense fog), snow (drifting flakes) — driven by hub `weather.changed`.
5. **Living touches**: NPC walk routes + idle animations, chickens peck/hop, butterflies flutter
   (2–3 on spline loops), cat wanders/naps/chases butterfly, fireflies at night (additive
   sprites), chimney smoke puffs, foliage sway (cheap vertex wobble or rotation jitter).
6. **Bloom** (selective-ish, low threshold high radius via `UnrealBloomPass`) for lamps, forge,
   fireflies. — *cut line: ship without if frame budget or time complains* —
7. Water animated shader on the dock area; footstep dust puffs; vignette.

Perf budget: 60fps on M-series laptop, < 300 draw calls (instancing everywhere), GLBs ≤ 20k tris.

## 5. World Hub (hub/) — systems

- **State**: one `World` object — `time`, `weather`, `npcs[]`, `animals[]`, `objects[]`,
  `quests[]`, `players[]`, `events[]` (ring buffer 500). Shapes in `shared/protocol.ts`, wire
  contract in [API.md](API.md).
- **Event log is the heartbeat.** Every mutation appends `{id, at, type, actor, summary, data}`.
  NPC dialogue context = last ~12 events. MCP exposes `GET /api/events`. The demo line "ask her
  what just happened — she saw it" is literally this array.
- **Sim tick** (10 Hz): NPC waypoint movement along authored daily routines (forge ↔ market ↔
  plaza…), animal behaviors (state machines: peck/wander/nap/chase), object lifetimes.
- **Ambient director** (every ~60–90s, rule-based, zero LLM cost): picks a small scene — NPC
  waves at another, cat chases butterfly, chicken escapes pen, NPC comments on weather via a
  canned-pool ambient bubble (or a one-line TrueForge flavor turn when cheap). Emits events.
- **Ingestors** (all fail-soft; on error keep last value, log once):
  | Source | Poll | Effect |
  |---|---|---|
  | Open-Meteo (SF 37.77,-122.42, no key) | 10 min | WMO code → `clear/clouds/rain/fog/snow/storm` → world weather + event |
  | Real clock (America/Los_Angeles) | 1 min | `time.phase` + sun angle; `POST /api/time` can override for demo (night mode!) |
  | Hacker News top stories | 5 min | top new headline → **Quest Scribe** turns it into a notice-board quest (≤1 active rumor quest at a time) |
  | GitHub commits on this repo (ETag, 90s) | 90 s | new commit → delivery crate object spawns in plaza + event `commit.landed` (author + message) — *push code, watch a crate appear* |
- **Dialogue broker**: `POST /api/npcs/:id/talk` → hub builds turn = `[WORLD NOW]` digest
  (time/weather/last events/active quests/nearby entities/player inventory) + player line →
  TrueForge session for that NPC (create lazily, keep forever = memory) → streams deltas back
  over the WS as `bubble` frames + final `npc.said` event. 10s stall → canned fallback line so
  the demo never hangs. Personas live beside NPC defs (keep v1's good habit).
- **Quest Scribe**: one TrueForge session that turns a headline into
  `{title, kawaiiPitch, steps[talk/goto/collect], reward}` JSON (schema-checked; on parse fail,
  retry once then skip). Quests are completable: talk-to-NPC and go-to-POI steps tracked by hub.

## 6. Kawaii bubbles — spec

DOM overlay (`#bubbles`), one element per active speaker, projected each frame from a 3D anchor
2.2m above the character (hide if behind camera; fade beyond 18m; scale slightly with distance).

Style: rounded 18px pastel bubble w/ 2px soft outline + tail, per-NPC pastel tint, drop shadow,
gentle 2s float bob; text types out from the stream (~30 chars/s catch-up so it never lags the
model); `…` pulsing thinking state while the agent works — with a tiny tool badge ("📡 asking the
ravens") when the harness reports a tool call; emotion accent parsed from a leading emoji or
`[happy]/[sad]/[shock]/[think]` tag in the reply (bounce, color shift, ♪/💧/❗ ornament). Max
width 280px, max 3 lines/bubble; longer replies paginate into successive bubbles. Ambient bubbles
(NPC↔NPC or NPC→world) auto-expire after 4s. Player's own lines echo in a small bubble too.

NPC personas get a style rule: **≤ 2 short sentences per bubble, cheerful, may end with a cute
interjection** — kawaii is enforced by prompt, rendered by CSS.

## 7. Assets — Tripo pipeline

Style bible (append to every prompt):
`"chibi voxel style, blocky Minecraft-like proportions, cute big head, pastel colors, kawaii, game-ready low poly, clean silhouette"`.
Palette anchors: mint `#A8E6CF` · peach `#FFD3B6` · coral `#FFAAA5` · cream `#FFF8E7` · sky `#B5E2FA`.

| Asset | Kind | Rig + anims | Fallback if late |
|---|---|---|---|
| Hero (chibi adventurer, tiny sword on back) | character | ✅ idle/walk/run | capsule |
| Bran — blacksmith (apron, mustache) | character | ✅ idle/walk | v1 capsule |
| Wren — herald (blue cape, scroll) | character | ✅ idle/walk | v1 capsule |
| Cat (round chibi) | animal | procedural motion | voxel-box cat |
| Chicken | animal | procedural hop | voxel-box chicken |
| Butterfly | animal | code flutter (2 quads) | — |
| Market stall, fountain, notice board, lamp post, crate, mailbox, anvil+forge, tree ×2, boat | props | none | voxel clusters (code-built) |

Pipeline `hub/tools/tripo.ts` (`npm run assets` in `hub/`): text→model task → poll → (characters)
rig → retarget idle/walk/run → download GLBs → `game/public/assets/models/<id>.glb` + manifest.
Cache by prompt hash — re-runs are free. Exact Tripo endpoints/params: see
[ASSETS-PIPELINE.md](ASSETS-PIPELINE.md) (API research cheatsheet).
**Start generation immediately after the pipeline exists** — tasks take minutes and can cook
while we build. The game must always run with fallbacks so assets are a pure upgrade, never a
blocker. `TRIPO_API_KEY` lives in `hub/.env` (gitignored) — **never commit it; rotate after the
event** (it was shared in chat today).

## 8. NPC roster v2

| NPC | Session persona adds | Tools story (harness track) |
|---|---|---|
| **Bran** the blacksmith (existing) | kawaii bubble style rule; comments on forge/weather/events | inventory + quest writes behind approvals |
| **Wren** the herald (existing) | announces commits + headlines; the "what's happening" NPC | Bright Data news via `quest-hero-web` |
| **Suki** the shopkeep (NEW) | market stall; prices riff on real data | Bright Data product/price lookups |
| *(cut line — only if time)* Luma weather sage | explains the real forecast | Open-Meteo via world MCP |

## 9. Milestones vs the clock (now ≈ 12:15)

| By | Milestone | Proof |
|---|---|---|
| 12:40 | **Specs committed**, API contract in MCP team's hands | this doc + API.md |
| 13:45 | **Hub live**: state+sim+WS+REST+ingestors, dialogue proxied through hub, client connected; Tripo pipeline started cooking assets | `curl :7777/api/world`; talk to Bran via hub; real SF weather in state |
| 15:00 | **World looks great**: voxel island, third person, day/night lighting, bubbles replace dialogue box | walkthrough feels like a game |
| 16:00 | **World is alive**: GLB characters animated, animals, routines, weather FX, commit→crate | push a commit on stage → crate drops |
| 16:45 | **Quests + polish**: headline quests on notice board, bloom/fireflies/night pass, Suki | accept + complete a rumor quest |
| 17:15 | Freeze. README refresh, demo rehearsal, backup video | 2-min script below |
| 18:00 | Submit | — |

**Rule from v1 stands:** nothing gets a successor until it works end-to-end in the browser.

## 10. Demo script (2 min)

1. Wake up in Ashford — camera orbits the island, it's *actually* SF's weather and light outside.
2. Walk to Wren: "what's going on?" → she cites a real headline + the crate that just arrived.
3. Teammate pushes a commit → crate thuds into the plaza, Wren announces the author live.
4. Notice board: today's headline became a quest — accept, complete a talk step with Bran (his
   session *remembers you* from earlier — refresh the page mid-quest to prove it).
5. Ask Suki a price → she consults the ravens (Bright Data tool badge on her bubble) → haggles.
6. `POST /api/weather {"condition":"rain"}` from the MCP client — rain sweeps the village, an
   NPC comments on it unprompted. "The world is an MCP surface."
7. Night override → lamps, forge glow, fireflies. Hold the shot. Submit.

## 11. Risks & mitigations

- **Tripo latency/rig quality** → pipeline first, generate early, fallbacks always playable,
  procedural animal motion doesn't wait on rigs.
- **TrueForge quirks** (context injection, tool wiring) → hub's canned-fallback lines keep
  dialogue alive; personas already proven in v1.
- **Rate limits** → GitHub with ETag @90s; Open-Meteo/HN well under; one active rumor quest.
- **Scope** → cut lines are marked in §4/§8; graphics list is priority-ordered; nothing below
  bloom blocks the demo.
- **Keys** → all in `.env`/TrueForge UI settings, gitignored; rotate Tripo + Bright Data after.
