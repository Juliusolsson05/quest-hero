# Feature isolation refactor

Refs #9. Pure restructuring, zero behavior change: the wire protocol
(`shared/protocol.ts`, `docs/API.md`), the rendered scene, and every REST/WS
endpoint stay byte-identical in meaning. The goal is that the next feature
attaches at a known seam instead of editing `main.ts` in four places.

## Boundary rule (the one law this refactor establishes)

**`game/` and `hub/` may import from `shared/` and never from each other.**
Today `game/src/main.ts` imports `hub/src/island.ts`. The generator is
deliberately shared (deterministic island on both sides, so the game runs on a
static host) — that makes it `shared/` code that happens to live in the wrong
package.

## Stages

### 1. `shared/island.ts` — move the world generator to the boundary

- **Produces**: `shared/island.ts` (generation + pure queries: `island`,
  `heightAt`, `tileAt`, `isLand`, `isRoad`, `walkable`, `blockedMove`,
  `canStep`, `isOpenSpot`, `randomWalkableNear`, `poi`, `POI_IDS`,
  `POI_LABELS`, `NEAR_TARGETS`, `SPAWN`) and `hub/src/nav.ts` (the NAV grid +
  `findPath` — hub-only, built from `island.tiles`/`island.blockers`).
  `hub/src/island.ts` is deleted; the six hub consumers and `game/src/main.ts`
  re-point.
- **Verified by**: hub typecheck + game build; grep proves no `hub/src` import
  remains under `game/src`.
- **Why separate**: this is the dependency-direction fix everything else
  assumes; mixing it with feature moves would hide which import broke what.

### 2. `hub/src/trueforge.ts` + `hub/src/scribe.ts` — split dialogue.ts

- **Produces**: `trueforge.ts` — the only file in the repo that speaks
  HTTP/SSE to the harness (`HarnessUnavailable`, model/connector discovery,
  `sessionFor`, `streamTurn`). `scribe.ts` — headline→quest authoring
  (`scribeQuest`, `validateSteps`, template fallback). `dialogue.ts` keeps only
  the talk broker: `[WORLD NOW]` digest, emotion parsing, conversations map.
- **Verified by**: hub typecheck; `chatter.ts`/`ingest.ts`/`api.ts` import the
  new modules, not `dialogue.ts` internals.
- **Why separate**: `chatter.ts` reaching into `dialogue.ts` for the harness
  client is the classic "feature imports feature for its buried infrastructure"
  tangle; a future harness change should touch one file.

### 3. Delete the dead v1 client

- **Produces**: `game/src/{npc,state,dialogue,harness}.ts` (~450 lines) and the
  orphaned `/api/v1` vite proxy removed.
- **Verified by**: grep shows nothing imports them (only each other); game
  build passes; nothing but dead `harness.ts` used `/api/v1`.
- **Why separate**: deletions reviewed on their own are provably safe; buried
  in a restructure they would be noise.

### 4. Single-source the copied idioms

- **Produces**: `game/src/voxel.ts` (`shadedBox` with explicit per-domain
  shade constants — the three call sites keep their exact current values) and
  `game/src/util.ts` (`angleToward`, `esc`).
- **Verified by**: game build; shade constants diffed against the originals.
- **Why separate**: mechanical, high-file-count, zero-decision — keep it out
  of the commits a reviewer must actually think about.

### 5. Feature modules — `main.ts` becomes wiring only

- **Produces**:
  - `game/src/irs/` — `arena.ts` (chamber + taxcollector, moved) and
    `index.ts` (`IrsEncounter`: door, knock state, veil fade, enter/leave,
    prompt/interact/update). Single consumer: `main.ts`.
  - `game/src/cartly/` — `phone.ts` (moved from `cartly.ts`), `carts.ts`
    (moved from `taxi.ts`), `index.ts` (the wiring that currently lives in
    `main.ts`). Single consumer: `main.ts`.
  - `game/src/hublink.ts` — owns the `Net`, the entire ServerFrame dispatch,
    the quests map, link watchdog, pose uplink, and the `ui.onSay`/`onAccept`
    sends. The only file that interprets ServerFrames.
  - `main.ts` — construction + one ordered `interactables` list
    (`{prompt, act}`), consumed by both the E-key handler and the prompt
    renderer, replacing the two if-chains that had to agree by hand.
- **Verified by**: game build + browser smoke test (city renders, NPCs stream,
  phone/feed open, IRS knock→enter→exit, cart summon UI).
- **Why separate**: this stage is pure movement once 1–4 hold; doing it first
  would entangle every other diff with it.

## What is being isolated, and what may not import it

| Module | Single consumer | Forbidden importers |
| --- | --- | --- |
| `shared/island.ts` | hub sim + game renderer | — (it imports only `shared/protocol`) |
| `hub/src/trueforge.ts` | `dialogue.ts`, `chatter.ts`, `scribe.ts` | `api.ts`, `sim.ts`, `state.ts`, anything in `game/` |
| `game/src/irs/` | `main.ts` | every other game module |
| `game/src/cartly/` | `main.ts` | every other game module |
| `game/src/hublink.ts` | `main.ts` | every other game module |

## Unknowns

- Whether `feat/irs-arena-wt` receives more commits while this branch is open
  (an agent worktree was active on it); the arena move in stage 5 would then
  need a rebase. Accepted risk, noted in the PR.
- Vite dev-server `fs.allow` for `../../shared` value imports — believed fine
  because `../../hub/src/island` already works from the same depth; the smoke
  test proves it.
- Whether the `-wt` `.claude/launch.json` port-5174 config interacts with the
  smoke test setup (it shouldn't; it's additive).

## Fixture / verification plan

No test suite exists and the game is explicitly demo-ware (hackathon); per the
project's testing philosophy, no tautological tests are added. Verification is:

1. `npm --prefix hub run typecheck` after every hub-touching stage
2. `npm --prefix game run build` (tsc --noEmit + vite) after every game stage
3. `grep -rn "hub/src" game/src` must return nothing after stage 1
4. Live smoke: hub on :7777 + vite dev, drive the browser — welcome frame
   paints the city, NPC poses stream, minimap live, phone (P) and feed (L)
   open, IRS door knock→enter→exit round-trips, talk bar opens on an NPC.
