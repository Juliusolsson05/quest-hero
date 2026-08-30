# Quest Hero

**A 3D game whose NPCs actually think.**

Built for the [Agent Harness Hackathon](https://www.wemakedevs.org/hackathons/trueforge) — Bright Data, San Francisco, August 29 2026. Submission deadline 18:00 PDT.

---

## Overview

We are building a 3D game whose NPCs can actually think and draw on current, real-world information.

The goal is two-fold: the game itself should be fully functional and genuinely fun to play, and every character in it should run on an agent harness with MCP tools available to it. That means an NPC can answer a player's questions about the world inside the game, and about the world outside it as well.

## How It Works

Each character is backed by an agent rather than a fixed dialogue tree. Because that agent has MCP tools at its disposal, an NPC is not limited to lines we wrote in advance. It can look things up, reason about what the player is asking, and respond in context — whether the question is about a quest, a game mechanic, or something happening in the real world today.

## The Three Parts of the Problem

We see this as three distinct pieces of work.

### 1. Web search in the MCP server

Giving the NPCs access to live, modern information. This is the part that lets a character speak to events and facts beyond anything baked into the game at build time.

### 2. Building a game that is actually good

The 3D game has to stand on its own. Smart NPCs are not a substitute for solid mechanics, and the experience needs to be fun to play even before the agent layer is considered.

### 3. Using MCP to make NPCs smart about game mechanics

Beyond outside knowledge, we want the characters to understand the game they live in. MCP is how we expose the game's own state and rules to the agents, so an NPC can reason about mechanics and help the player navigate them.

---

## The Harness: TrueForge

The agent layer is built on [TrueForge](https://github.com/truefoundry/trueforge), TrueFoundry's open-source agent harness (MIT). We do not write our own agent loop — the harness runs it, and our job is the game and the tools we hand it.

TrueForge is TypeScript/Node (>= 22.14), which is why the whole stack is TypeScript: the game, the MCP servers, and the harness wiring all speak the same language.

```bash
npx @truefoundry/trueforge@latest   # harness server, default http://localhost:8790
npm i @truefoundry/trueforge-sdk    # what the game talks to
```

### One session per NPC

A TrueForge *session* holds context and state across turns. That maps onto an NPC exactly: the blacksmith remembers the last three things you asked him, because he is one long-lived session, not a stateless prompt.

```ts
import { TrueForge } from '@truefoundry/trueforge-sdk';

const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790' });

// One session per NPC, created when the character spawns and kept for the run.
const { data: session } = await client.sessions.create({
  agent: { spec: { model: { name: /* from the model catalog */ }, instructions: BLACKSMITH_PERSONA } },
});

// A player talking to an NPC is a turn. Stream it so dialogue types out in-world.
const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: 'user.message', content: playerLine }],
});

for await (const { data: event } of stream.withMetadata()) {
  if (event.type === 'model.message.delta') renderDialogue(event.content ?? '');
  if (event.type === 'turn.done') endDialogue(event.state.status);
}
```

### What the harness gives us, and what we do with it

| TrueForge capability | How Quest Hero uses it |
| --- | --- |
| MCP servers (incl. OAuth, remote) | Two of our own: game state/rules, and live web data |
| Built-in tools + web search | NPC fallback for general world knowledge |
| Sandboxed execution (Daytona) | Agent-written code never touches the game process |
| Human approvals | The player approves before an NPC changes world state |
| Subagents | A quest-giver delegates lookups without polluting its own context |
| Sessions that survive reconnects | An NPC keeps its memory across a page refresh |
| Any model provider | Swap per-NPC: a cheap model for a merchant, a strong one for a boss |

The full harness documentation is vendored at [`docs/trueforge/`](docs/trueforge/) so it is greppable offline and diffable when upstream changes — refresh it with `./scripts/sync-trueforge-docs.sh`.

Configuration lives in YAML catalogs (models, MCP servers, sandbox) and git-backed `SKILL.md` packs — so NPC personas and tool access are version-controlled, reviewable, and diffable rather than hardcoded.

## The MCP servers we own

**`quest-hero-world`** — the game exposed as tools. Reads: player inventory, position, quest state, faction standing, the rules of combat and crafting. Writes: give item, advance quest, set waypoint. Writes are the ones that go behind an approval gate.

**`quest-hero-mark`** — the boss fight's brain-stem ([mcp/mark](mcp/mark)): SF trivia with deterministic judging and taunt material. Mark the startup enemy recites questions and gloats through a TrueForge session; correctness — and therefore boss-fight damage — comes from the tool, never the model.

**`quest-hero-web`** — live web data via [Bright Data](https://brightdata.com), so a character can speak to what is true today. Scraper configuration is committed to the repo and reused by the agent automatically, and the pipeline is expected to notice when a target site changes and repair itself rather than silently going stale.

Two more shipped, each attached to exactly one character — withholding a tool is far more reliable than instructing a model not to use it:

**[`sf-guide`](mcp/sf-guide/)** (:8811) — 33 live San Francisco data sources behind 8 tools, for Dylan, a tourist guide who has not noticed he is in a medieval village. No API keys.

**[`wall-street`](mcp/wall-street/)** (:8812) — live quotes, price history, market indices, and official SEC filings behind 7 tools, for Preston, who deals in public markets and actual numbers. No API keys. He never states a figure he did not fetch, and he never gives investment advice.

## Design note: approval gates are a game mechanic

The hackathon asks for an interface that shows what the agent is doing, what it is waiting on, and asks before the irreversible step. In a game that is not a modal dialog bolted on top — it is the NPC saying *"I can forge that, but it will cost your last ingot. Shall I?"* and waiting. The approval gate and the dialogue are the same thing.

## Tracks

| Track | Prize | Our angle |
| --- | --- | --- |
| **Best Use of the Agent Harness** | NVIDIA DGX Spark | Primary. Every NPC is a harness session — subagents, MCP, approvals, persistence all load-bearing, not a wrapper |
| **Best use of Bright Data** | AirPods 4 | `quest-hero-web`: version-controlled scraper config, self-repairing pipeline feeding in-game dialogue |
| **Best UI** | iPad | Approval gates as diegetic dialogue; the player can always see what a character is doing and waiting on |
| **Best Code Quality** | Mac Mini | Every PR through [Qodo](https://www.qodo.ai) before merge — required for this track |
| **Best blog post** | Keychron keyboard | Write-up of the build and what broke |

## Stack

- **Harness** — TrueForge (`@truefoundry/trueforge-sdk`)
- **Game** — TypeScript, WebGL/3D in the browser
- **Tools** — MCP servers for game state and live web data
- **Data** — Bright Data
- **Review** — Qodo on every PR
- **Models** — provider-neutral via the TrueForge model catalog (OpenAI credits provided; Anthropic and Gemini also available)

## Repo

Open source, as the hackathon requires.

## Build docs

- [docs/SPEC.md](docs/SPEC.md) — the v2 build spec (voxel world, World Hub, live-data village)
- [docs/API.md](docs/API.md) — the World Hub REST/WS/SSE contract the MCP servers wrap
- [docs/ASSETS-PIPELINE.md](docs/ASSETS-PIPELINE.md) — Tripo character pipeline cheatsheet

## Run it

```bash
npx @truefoundry/trueforge@latest        # 1. harness on :8790 (paste a model key in Settings → Models)
npm --prefix hub install && npm --prefix hub run dev    # 2. World Hub on :7777
npm --prefix game install && npm --prefix game run dev  # 3. game on :5173
npm --prefix mcp/sf-guide install --include=dev && npm --prefix mcp/sf-guide run dev        # 4. SF data MCP on :8811
npm --prefix mcp/wall-street install --include=dev && npm --prefix mcp/wall-street run dev  # 5. markets MCP on :8812
npm --prefix mcp/mark install --include=dev && npm --prefix mcp/mark run dev                # 6. Mark's trivia MCP on :8813
node tools/tripo.mjs                     # optional: generate rigged characters (needs TRIPO_API_KEY in .env)
```

All three MCP servers need registering in TrueForge once — see the `curl` in each server's README.
`--include=dev` matters: `NODE_ENV=production` in the shell makes npm skip devDependencies silently.

The game is fully playable with zero keys configured: NPCs fall back to canned lines until
TrueForge has a model, and characters use kawaii voxel placeholders until Tripo GLBs land.

## Share it (sf-quest.vercel.app)

The hosted client generates the city itself, so the link works with nothing running — but the
citizens live in your hub, and a hosted page cannot reach `ws://localhost` (that address is the
visitor's own machine). Expose the hub, then build against it:

```bash
npm --prefix game run tunnel          # cloudflared → prints https://<name>.trycloudflare.com
VITE_HUB_WS="wss://<name>.trycloudflare.com/ws" npm --prefix game run deploy
```

Quick tunnels mint a new hostname each start, so re-run both lines after restarting one. No
rebuild needed to retarget a client: `?hub=wss://…` overrides the baked-in default and is
remembered (`?hub=` alone forgets it). Without a reachable hub the city still walks, drives and
plays multiplayer — the chip reads "solo city — citizens asleep" and the NPCs simply aren't there.

## Status

Specs frozen (docs/SPEC.md). World Hub + voxel third-person client implemented and integrated:
real SF weather and time drive the island, REST writes (weather/objects/npc say) appear in-game
within a tick, and pushed commits land as delivery crates that Wren announces. Dialogue runs on
canned fallbacks until a model key is pasted into TrueForge (Settings → Models); Tripo characters
pending a valid `TRIPO_API_KEY` (kawaii voxel placeholders meanwhile).
