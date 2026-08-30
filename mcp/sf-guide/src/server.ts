import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SOURCES, USABLE } from './sources.js';
import {
  queryDataset, describeDataset, liveConditions,
  earthquakes, tidesAndSun, bikeShare, nearbyLandmarks,
} from './fetchers.js';

/**
 * MCP server for the SF tourist guide NPC.
 *
 * Registered in TrueForge as a remote connector, so it speaks Streamable HTTP
 * rather than stdio — that is the transport the harness reported when it
 * connected to Tavily, and stdio would require it to spawn our process.
 *
 * Stateless (`sessionIdGenerator: undefined`): every tool call is independent
 * and the conversational state lives in the harness session, not here. That
 * also means a restart of this server never orphans a session mid-dialogue.
 *
 * Eight tools cover all 33 sources rather than one tool per source. Thirty-three
 * tool definitions would crowd the agent's context before it had said a word,
 * and one parameterised query tool lets it compose filters we never anticipated.
 */

const PORT = Number(process.env.SF_GUIDE_PORT ?? 8811);

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Tool failures are returned as content, not thrown. A thrown error reaches
 *  the model as a protocol failure it cannot reason about; a message telling it
 *  the dataset id was wrong lets it correct itself and try again. */
function fail(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'sf-guide', version: '0.1.0' });

  server.registerTool(
    'sf_list_sources',
    {
      title: 'List San Francisco data sources',
      description:
        'STEP 1 of any dataset lookup. Lists every San Francisco dataset and live feed this ' +
        'server can reach, as [{id, title, kind, about}]. The `id` is exactly what you pass ' +
        'as `source_id` to sf_describe_dataset and sf_query_dataset. Covers ~30 sources: ' +
        'film locations, street trees, public art, food trucks, restaurant inspections, ' +
        'Muni stops, parks, public toilets, 311 complaints, police incidents, and more. ' +
        'No inputs. Call this whenever you are not 100% certain a dataset exists or what ' +
        'its id is — never guess an id.',
      inputSchema: {},
    },
    async () =>
      ok(USABLE.map((s) => ({ id: s.id, title: s.title, kind: s.kind, about: s.blurb }))),
  );

  server.registerTool(
    'sf_describe_dataset',
    {
      title: 'Describe a dataset',
      description:
        'STEP 2 of a dataset lookup. Returns {source, columns: [...]} — the REAL column ' +
        'names of one DataSF dataset. Always call this before writing a `where` filter for ' +
        'sf_query_dataset: guessed field names cause query errors. Input: `source_id`, an ' +
        'id from sf_list_sources (e.g. "film_locations", "street_trees", "food_trucks").',
      inputSchema: { source_id: z.string().describe('id from sf_list_sources, e.g. "film_locations"') },
    },
    async ({ source_id }) => {
      try { return ok(await describeDataset(source_id)); } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'sf_query_dataset',
    {
      title: 'Query a San Francisco dataset',
      description:
        'STEP 3: fetch rows from one DataSF dataset. Returns {source, rows: [...]} — rows ' +
        'are trimmed (no geometry blobs) and capped at 50; default limit is 10. Workflow: ' +
        'sf_list_sources → sf_describe_dataset → this. `where` accepts SoQL, so you can ' +
        "filter precisely — e.g. qSpecies like '%Ficus%' on street_trees, " +
        "title like '%Vertigo%' on film_locations, neighborhoods='Mission' where that " +
        'column exists. If the query errors, re-check the column names with ' +
        'sf_describe_dataset instead of retrying the same filter.',
      inputSchema: {
        source_id: z.string().describe('id from sf_list_sources'),
        where: z.string().optional().describe("SoQL filter using REAL column names from sf_describe_dataset, e.g. \"qspecies like '%Ficus%'\""),
        select: z.string().optional().describe('comma-separated columns to return (default: all trimmed columns)'),
        order: z.string().optional().describe('column to sort by, optionally with DESC, e.g. "filingdate DESC"'),
        limit: z.number().optional().describe('rows to return, 1-50 (default 10)'),
      },
    },
    async ({ source_id, where, select, order, limit }) => {
      // Tool arguments are snake_case because that is what reads naturally to a
      // model; the internal API is camelCase. Map at the boundary.
      try { return ok(await queryDataset({ sourceId: source_id, where, select, order, limit })); }
      catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'sf_live_conditions',
    {
      title: 'Current San Francisco conditions',
      description:
        'San Francisco RIGHT NOW, in one call: temperature_c, feels_like_c, wind_kmh, ' +
        'cloud_cover_pct, visibility_m with a plain-language `fog` reading ' +
        '("thick fog" / "hazy / light fog" / "clear"), plus air quality (us_aqi, pm2_5). ' +
        'No inputs. This is THE tool for "is it foggy", "what should I wear", "how is ' +
        'the air today", or any question about current SF weather.',
      inputSchema: {},
    },
    async () => { try { return ok(await liveConditions()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_earthquakes',
    {
      title: 'Recent Bay Area earthquakes',
      description:
        'The 10 most recent earthquakes within 150 km of San Francisco (live from USGS), ' +
        'newest first, as [{magnitude, place, when}]. No inputs. Use for any "was there ' +
        'an earthquake" / "is the ground shaking" question. An empty list means none ' +
        'recently — say so, do not invent one.',
      inputSchema: {},
    },
    async () => { try { return ok(await earthquakes()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_tides_and_sun',
    {
      title: 'Tides, sunrise and sunset',
      description:
        "Today's high/low tides under the Golden Gate (NOAA Fort Point, as " +
        '{tides_today: [{time, feet, kind}]}) plus sunrise and sunset times. No inputs. ' +
        'Use for photography timing ("when is golden hour"), waterfront plans, and ' +
        'anything tide- or daylight-related.',
      inputSchema: {},
    },
    async () => { try { return ok(await tidesAndSun()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_bike_share',
    {
      title: 'Bay Wheels bike availability',
      description:
        'Live Bay Wheels network totals right now: {stations, bikes_available, ' +
        'docks_available}. No inputs. Use for "can I grab a bike" — note it is a ' +
        'city-wide total, not per-station.',
      inputSchema: {},
    },
    async () => { try { return ok(await bikeShare()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_nearby_landmarks',
    {
      title: 'Landmarks near a point',
      description:
        'Everything with a Wikipedia article near a coordinate, nearest first, as ' +
        '[{title, metres_away}]. All inputs optional: defaults to downtown San Francisco ' +
        '(37.7749, -122.4194) with a 1500 m radius (max 10000). Use to build a walking ' +
        'tour or answer "what is worth seeing near X" — pass lat/lon only when the ' +
        'player names a specific place you know coordinates for.',
      inputSchema: {
        lat: z.number().optional().describe('latitude (default 37.7749, downtown SF)'),
        lon: z.number().optional().describe('longitude (default -122.4194, downtown SF)'),
        radius_m: z.number().optional().describe('search radius in metres, default 1500, max 10000'),
      },
    },
    async ({ lat, lon, radius_m }) => {
      try { return ok(await nearbyLandmarks(lat ?? 37.7749, lon ?? -122.4194, radius_m ?? 1500)); }
      catch (e) { return fail(e); }
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

/**
 * A fresh server and transport per request. The SDK's transport is not designed
 * to be shared across concurrent stateless requests, and building one costs
 * nothing next to the HTTP calls the tools make.
 */
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// Stateless mode has nothing to resume or terminate, but clients probe these.
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'stateless server: use POST' }));
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'stateless server: use POST' }));

app.get('/health', (_req, res) =>
  res.json({ ok: true, sources: SOURCES.length, usable: USABLE.length }));

// On Vercel this module is imported for buildServer() by the /api/mcp/* function
// wrappers — binding a port there would crash the function runtime.
if (!process.env.VERCEL) app.listen(PORT, () => {
  console.log(`sf-guide MCP on http://localhost:${PORT}/mcp  (${USABLE.length} sources)`);
});
