# SF Guide — MCP server

Live San Francisco city data as MCP tools, for an NPC who does not belong in a
medieval town and has not noticed.

**Status:** working and verified against the running harness. TrueForge lists
all 8 tools; calls return live weather, real earthquakes, and real film
locations. Nothing here is stubbed.

**It is self-contained.** One directory, no shared code, no database, and no
credentials. It does not care which game client is in front of it — it only
needs TrueForge to be able to reach its URL.

---

## Run it

```bash
cd mcp/sf-guide
npm install --include=dev     # --include=dev matters, see Gotchas
npm run dev                   # http://localhost:8811/mcp
curl localhost:8811/health    # {"ok":true,"sources":33,"usable":32}
```

Port via `SF_GUIDE_PORT`. Default 8811, chosen to avoid TrueForge (8790) and
the Vite dev server (5173).

## Register it in TrueForge

Either paste this once:

```bash
curl -X PUT http://localhost:8790/api/v1/settings/mcp-servers \
  -H 'content-type: application/json' \
  -d '{"manifest":{
    "type":"remote",
    "name":"sf-guide",
    "url":"http://localhost:8811/mcp",
    "description":"Live San Francisco city data: DataSF open datasets plus real-time weather, air quality, earthquakes, tides, bike share and landmarks."
  }}'
```

…or use **Settings → Connectors → Add MCP Server** with that URL. No auth —
the manifest omits `auth` entirely and the server reports `not_required`.

Confirm the harness can reach it:

```bash
curl localhost:8790/api/v1/mcp-servers/sf-guide/tools
```

## Attach it to the NPC

The connector is per-agent, so only the guide gets it. In the agent spec:

```jsonc
{
  "agent": {
    "spec": {
      "model": { "name": "openai/gpt-5-5" },
      "instructions": "<persona below>",
      "mcp_servers": [{ "name": "sf-guide" }]
    }
  }
}
```

Give it to **this character only**. The joke stops working if the blacksmith
can also look up bike docks, and withholding a tool is far more reliable than
instructing a model not to use one.

---

## The character

**Dylan. San Francisco tourist guide. Genuinely lost, cheerfully unaware.**

He is convinced he is still in San Francisco. He has decided Ashford is an
immersive themed experience somewhere in the East Bay, and he is *impressed* —
the actors never break, the set dressing is incredible, someone really
committed to that forge.

He is never sarcastic and never winking at the player. The comedy comes
entirely from him not noticing. A quest becomes a scavenger hunt. A blacksmith
becomes an artisanal maker space in the Mission. A cracked sword is a great
photo op. He will cheerfully offer you a walking tour of a town that has no
pavements.

**Voice:** over-caffeinated startup person. "Circle back", "super stoked",
"that's a whole vibe". Two or three sentences unless asked for more.

**The one hard rule:** he never invents a statistic. If he did not fetch it, he
says he will pull it up. Everything he claims about San Francisco comes from a
tool call the player can watch happen.

### Persona string, ready to paste

```
You are Dylan, a San Francisco tourist guide. You are certain you are still in
San Francisco — you assume this town is an immersive themed experience
somewhere in the East Bay, and you are impressed by the commitment of the
actors. You are cheerful, over-caffeinated, and you talk like a startup person:
"circle back", "super stoked", "that is a whole vibe".

You have a laptop and live access to real San Francisco city data, and you use
your tools constantly rather than recalling anything from memory. You never
invent a statistic — if you did not fetch it, you say you will pull it up.

When someone asks about swords, quests, forges or anything medieval, you
cheerfully misread it as being about San Francisco: a quest becomes a scavenger
hunt, a blacksmith becomes an artisanal maker space in the Mission. You are
never sarcastic about it; you genuinely do not notice.

Keep answers to two or three sentences unless asked for detail, and always
ground them in data you actually fetched.
```

### How he should look

The anachronism has to be visible from across the square, before he says a
word. Everyone else is lit by fire; he is lit by a screen.

- **An open laptop**, carried or on a crate. This is the single most important
  prop — it reads instantly and it is the visual punchline.
- **Screen glow on his face.** A small cool-white or blue point light at the
  laptop, against the forge's warm orange. In a scene lit by firelight, one
  character lit blue is unmissable.
- **Modern silhouette:** hoodie or puffer, lanyard, backpack, glasses. Muted
  grey-blue against the browns and oranges of the town.
- **Anywhere the player passes early.** He should be discoverable in the first
  thirty seconds, because he is the demo.
- **Optional and worth it:** a takeaway coffee cup, and a phone he checks
  mid-conversation.

Suggested palette: body `#8a93a8`, screen emissive `#9fd0ff`.

---

## The tools

Eight tools cover 33 sources. That is deliberate — 33 tool definitions would
crowd the agent's context before it spoke, and one parameterised query tool
lets it compose filters nobody anticipated.

| Tool | What it does |
| --- | --- |
| `sf_list_sources` | Every dataset and feed, with ids. Call first when unsure. |
| `sf_describe_dataset` | Column names, so filters use real field names. |
| `sf_query_dataset` | Query any DataSF dataset. Takes SoQL in `where`. |
| `sf_live_conditions` | Temperature, wind, AQI, and visibility with a plain-language fog reading. |
| `sf_earthquakes` | Every quake within 150km, with magnitude and time. |
| `sf_tides_and_sun` | Tides under the Golden Gate, sunrise, sunset. |
| `sf_bike_share` | Live Bay Wheels bike and dock counts. |
| `sf_nearby_landmarks` | Anything with a Wikipedia article near a coordinate. |

### What the data covers

**Culture** — film locations (which movie was shot on which corner), ~200k
street trees by species, public art, historic landmarks, and POPOS: rooftop
gardens downtown that are legally public and almost nobody knows exist.

**Food** — food truck permits, restaurant inspection scores, business
registrations.

**Getting around** — Muni stops, bike racks, parking meters, street sweeping
(the schedule that decides whether your car gets towed), closures, curb ramps.

**The city as it is** — 311 complaints, police incidents, eviction notices,
aircraft noise complaints, sea-level-rise flood zones.

**Live, no key** — weather with visibility, air quality, NWS forecast,
earthquakes, tides, sunrise/sunset, bike share, Wikipedia geosearch.

### Questions that show it off

Single lookups are unimpressive. The demo is watching him **chain sources for a
question nobody wrote a tool for**:

> *"I want to photograph the Golden Gate in fog tomorrow morning."*
> visibility + forecast + sunrise + tides — four tools, one answer.

> *"What's this neighbourhood actually like?"*
> 311 complaints + evictions + new businesses + tree density.

> *"Where do I eat without getting food poisoning, and can I park?"*
> food trucks + inspection scores + meters + street sweeping.

And the ones that land because of where he is standing:

> *"Is it foggy?"* — he answers in metres of visibility, in a fantasy town.
> *"Where's the nearest bathroom?"* — he has a real dataset for this.
> *"My sword is broken."* — he recommends a maker space in the Mission.

---

## Gotchas

**`npm install` needs `--include=dev`** on this machine. `NODE_ENV=production`
is set in the shell environment, which makes npm silently skip every
devDependency — the build then fails on missing types with no obvious cause.

**Streamable HTTP, not stdio.** That is the transport TrueForge reports when it
connects (`"transport_type":"streamable-http"`), and stdio would require the
harness to spawn our process.

**Stateless by design.** `sessionIdGenerator: undefined`, a fresh server per
request. Conversational state lives in the harness session, so restarting this
server never orphans a dialogue mid-sentence.

**Rows are trimmed before the model sees them.** Geometry blobs, duplicated
coordinates and long free text are dropped, and results are capped at 50. A raw
Socrata page is hundreds of KB of repeated fields, and an NPC that floods its
own context with tree records stops being able to hold a conversation.

**Tool errors are returned as content, not thrown.** A wrong dataset id comes
back as a readable message the model can correct from, rather than a protocol
error it cannot reason about.

**The DataSF catalog federates across cities.** Searching it unfiltered returns
NYC restaurant inspections and Chicago crime wearing San Francisco's name.
Every id in `src/sources.ts` was constrained to `data.sfgov.org` and then
probed individually to confirm it returns rows. If you add sources, do the
same — a catalog entry is not a live dataset.

**One source needs a key and is excluded.** 511 real-time BART/Muni departures
needs a free token from `511.org/open-data/token`. It is marked
`token-required` and filtered out of the default tool set so the guide never
offers data it cannot fetch. If you get a token, that is the single most useful
addition — "when's the next N Judah" is what people actually ask a guide.

## Adding a source

`src/sources.ts` is configuration, not documentation — the server builds its
tools from it, so it cannot drift from what is actually served. Add an entry,
restart. DataSF sources need only a Socrata resource id.
