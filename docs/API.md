# World Hub API — contract for the MCP team

Base URL: **`http://localhost:7777`** · no auth in hackathon mode (localhost only) · all bodies JSON.
Wire types live in [`shared/protocol.ts`](../shared/protocol.ts) — import them, don't redeclare.

This is the **one** surface for reading/writing game state. `quest-hero-world` MCP tools should be
thin wrappers over these endpoints (suggested mapping at the bottom). Everything you write through
this API becomes visible in-game within one sim tick (≤100ms) and is announced to NPCs via the
event log.

## Core shapes (abridged — see protocol.ts)

```ts
type WeatherKind = 'clear'|'clouds'|'rain'|'fog'|'snow'|'storm';
type TimePhase   = 'dawn'|'day'|'dusk'|'night';
type Emotion     = 'happy'|'sad'|'shock'|'think'|'neutral';

interface WorldEvent { id: number; at: number; type: string; actor?: string;
                       summary: string; data?: Record<string, unknown> }
// event types include: weather.changed time.phase npc.moved npc.said npc.action
// animal.action object.spawned object.removed quest.created quest.accepted
// quest.step quest.completed commit.landed player.joined player.said mcp.custom

interface Npc    { id: string; name: string; role: string; pos: Vec3; activity: string;
                   mood: Emotion; persona: string;
                   look?: 'villager'|'techbro-phone'|'techbro-laptop'|'investor' }
interface WObject{ id: string; kind: string; pos: Vec3; spawnedBy: string; expiresAt?: number }
interface Quest  { id: string; title: string; pitch: string; giver: string;
                   source: {type:'headline'|'handcrafted'|'mcp'; ref?: string};
                   steps: {id:string; kind:'talk'|'goto'|'collect'; target:string;
                           text:string; done:boolean}[];
                   state: 'offered'|'active'|'done'; reward: {coins:number; item?:string} }
interface World  { time: {phase:TimePhase; hour:number; real:boolean};
                   weather: {kind:WeatherKind; tempC:number; real:boolean; summary:string};
                   npcs: Npc[]; animals: Animal[]; objects: WObject[]; quests: Quest[];
                   players: Player[]; recentEvents: WorldEvent[] }
```

## Read

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ok, uptimeS, version}` |
| `GET /api/world` | full `World` snapshot (the everything call) |
| `GET /api/npcs` · `GET /api/npcs/:id` | NPC list / one NPC (includes persona + activity) |
| `GET /api/events?since=<id>&limit=50&types=a,b` | events after id `since`, oldest→newest |
| `GET /api/events/stream` | **SSE** — every new event as `data: <WorldEvent JSON>\n\n` (easiest live feed for an MCP server) |
| `GET /api/quests` | all quests |
| `GET /api/weather` · `GET /api/time` | current weather / time block |
| `GET /api/player` | player pos + inventory + active quest |
| `GET /api/island` | tile layout + POI table (static per run) |

## Write (each returns the updated resource + emits an event)

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/npcs/:id/say` | `{text, emotion?}` | NPC speaks a bubble in-world **right now** (no LLM — puppeteering; great for MCP demos) |
| `POST /api/npcs/:id/goto` | `{poi}` (see `/api/island` POIs) | NPC walks there |
| `POST /api/objects` | `{kind, pos?|near?:'plaza'\|'forge'\|…, ttlS?}` | spawn object; `kind` ∈ catalog: `crate,barrel,flower,pumpkin,gift,torch,snowman` |
| `DELETE /api/objects/:id` | — | remove object |
| `POST /api/weather` | `{kind, minutes?}` | override weather (visuals change in seconds); `{kind:'auto'}` resumes real SF weather |
| `POST /api/time` | `{phase}` or `{hour}` or `{mode:'real'}` | override time of day (demo night mode) |
| `POST /api/quests` | `{title, pitch, giver?, steps?, reward?}` | create a notice-board quest (source `mcp`) |
| `POST /api/quests/:id/advance` | `{stepId?}` | mark next/named step done |
| `POST /api/events` | `{summary, data?}` | inject a custom event (`mcp.custom`) — NPCs will see it in their next `[WORLD NOW]` digest and can gossip about it |
| `POST /api/player/give` | `{item, n?}` | grant inventory (behind your MCP approval gate!) |
| `POST /api/npcs/:id/talk` | `{text, from?}` | full agent turn via TrueForge; responds `{conversationId}`, reply streams over WS + lands as `npc.said` event. MCP callers who just want text can poll `GET /api/conversations/:id` → `{done, text}` |
| `POST /api/chatter` | `{a?, b?}` (npc ids; omit to auto-pick) | start an NPC↔NPC conversation NOW about this week's real SF/tech news (Reporter agent w/ tavily + sf-guide → Playwright script → alternating bubbles in-world). 400 if one is already running |
| `GET /api/chatter` | — | chatter status: `{running, lastTopic, nextInS, newsAgeS, newsItems}` (read table, listed here for locality) |

Errors: `4xx {error: string}`. Unknown `kind`/`poi`/ids → `400` with the allowed values listed.

## WebSocket `ws://localhost:7777/ws` (game client protocol)

Server→client frames (JSON, `{t: type, ...}`):
`welcome {world, island}` · `event {event}` · `pose {npcs:[{id,pos,rot,anim}], animals:[…]}` (10Hz)
· `bubble {who, convId?, text, emotion, mode:'delta'|'commit'|'ambient'|'thinking'|'tool'}`
· `weather {…}` · `time {…}` · `object {op:'add'|'remove', object}` · `quest {quest}`

· `boss {ev:'say'|'question'|'verdict', …}` — Mark the startup enemy's fight channel;
  sent only to the socket that asked, never broadcast (rounds are private per player)

Client→server: `hello {name}` · `pose {pos,rot,anim}` (10Hz) · `talk {npcId, text}`
· `interact {targetId}` · `quest {id, action:'accept'}`
· `boss {do:'question'}` / `boss {do:'taunt'}` / `boss {do:'answer', qid, text}` —
  request a trivia round, an idle insult, or submit an answer (see mcp/mark)

MCP servers normally don't need the WS — use REST + SSE.

## Suggested MCP tool mapping (`quest-hero-world`)

| Tool name | Wraps | Notes |
|---|---|---|
| `world_snapshot` | GET /api/world | trim `recentEvents` to ~10 for token size |
| `world_events` | GET /api/events | give the model `since` cursor semantics |
| `npc_list` / `npc_get` | GET /api/npcs… | |
| `npc_say` / `npc_goto` | POST …/say, …/goto | writes → approval gate |
| `spawn_object` / `remove_object` | POST/DELETE /api/objects | approval gate |
| `set_weather` / `set_time` | POST /api/weather, /api/time | approval gate |
| `create_quest` / `advance_quest` | POST /api/quests… | approval gate |
| `give_item` | POST /api/player/give | approval gate |
| `post_event` | POST /api/events | the "make the town gossip about X" tool |

Smoke test once the hub is up:
```bash
curl -s localhost:7777/api/world | head -c 400
curl -s -X POST localhost:7777/api/weather -H 'content-type: application/json' -d '{"kind":"rain"}'
curl -s -X POST localhost:7777/api/npcs/wren/say -H 'content-type: application/json' -d '{"text":"An MCP server told me to say hi!! ✨","emotion":"happy"}'
```
