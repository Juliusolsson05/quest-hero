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

function buildServer(): McpServer {
  const server = new McpServer({ name: 'sf-guide', version: '0.1.0' });

  server.registerTool(
    'sf_list_sources',
    {
      title: 'List San Francisco data sources',
      description:
        'Every San Francisco dataset and live feed available, with the id to pass to other tools. ' +
        'Call this first when you are not certain a dataset exists.',
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
        'Column names for a DataSF dataset. Call this before sf_query_dataset when writing a filter, ' +
        'so the filter uses real field names rather than guessed ones.',
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
        'Query any DataSF dataset. `where` accepts SoQL, so you can filter precisely — for example ' +
        `qSpecies like '%Ficus%' on street_trees, or title like '%Vertigo%' on film_locations. ` +
        'Use sf_describe_dataset first to learn the column names.',
      inputSchema: {
        source_id: z.string().describe('id from sf_list_sources'),
        where: z.string().optional().describe("SoQL filter, e.g. \"neighborhood='Mission'\""),
        select: z.string().optional().describe('comma-separated columns to return'),
        order: z.string().optional().describe('column to sort by, optionally with DESC'),
        limit: z.number().optional().describe('rows to return, 1-50, default 10'),
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
        'Temperature, wind, air quality, and visibility with a plain-language fog reading. ' +
        'Use this for "is it foggy", "what should I wear", or anything about right now.',
      inputSchema: {},
    },
    async () => { try { return ok(await liveConditions()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_earthquakes',
    {
      title: 'Recent Bay Area earthquakes',
      description: 'Every earthquake within 150km of San Francisco recently, with magnitude and time.',
      inputSchema: {},
    },
    async () => { try { return ok(await earthquakes()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_tides_and_sun',
    {
      title: 'Tides, sunrise and sunset',
      description:
        'High and low tides under the Golden Gate today, plus sunrise and sunset. ' +
        'Use for photography timing and anything at the waterfront.',
      inputSchema: {},
    },
    async () => { try { return ok(await tidesAndSun()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_bike_share',
    {
      title: 'Bay Wheels bike availability',
      description: 'Live bike and dock counts across the Bay Wheels network.',
      inputSchema: {},
    },
    async () => { try { return ok(await bikeShare()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'sf_nearby_landmarks',
    {
      title: 'Landmarks near a point',
      description:
        'Anything with a Wikipedia article near a coordinate, nearest first. ' +
        'Defaults to downtown San Francisco. Good for building a walking tour.',
      inputSchema: {
        lat: z.number().optional().describe('latitude, default 37.7749'),
        lon: z.number().optional().describe('longitude, default -122.4194'),
        radius_m: z.number().optional().describe('search radius in metres, max 10000'),
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

app.listen(PORT, () => {
  console.log(`sf-guide MCP on http://localhost:${PORT}/mcp  (${USABLE.length} sources)`);
});
