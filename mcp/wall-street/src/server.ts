import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { INTERVALS, MARKET_INDICES, RANGES } from './sources.js';
import { filings, fundamentals, fxRate, history, marketSnapshot, quote, search } from './fetchers.js';

/**
 * MCP server for Preston, the public-markets NPC.
 *
 * Registered in TrueForge as a remote connector, so it speaks Streamable HTTP
 * rather than stdio — the same transport mcp/sf-guide uses, and the one the
 * harness reports when it connects. stdio would require it to spawn us.
 *
 * Stateless (`sessionIdGenerator: undefined`): every tool call is independent
 * and the conversational state lives in the harness session, not here. A
 * restart never orphans a session mid-dialogue.
 *
 * Seven tools, no API keys. Everything is a public endpoint that answered
 * without credentials on 2026-08-29 — the game must run on a fresh clone with
 * an empty .env.
 */

const PORT = Number(process.env.WALL_STREET_PORT ?? 8812);

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Tool failures are returned as content, not thrown. A thrown error reaches
 *  the model as a protocol failure it cannot reason about; a message telling it
 *  the ticker was wrong lets it correct itself and call stock_search instead. */
function fail(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'wall-street', version: '0.1.0' });

  server.registerTool(
    'stock_search',
    {
      title: 'Find a ticker symbol',
      description:
        'Resolve a company name to its ticker symbol, with sector and exchange. ' +
        'Call this first whenever you are not certain of a symbol — never guess one.',
      inputSchema: { query: z.string().describe('company or fund name, e.g. "nvidia" or "vanguard s&p"') },
    },
    async ({ query }) => {
      try { return ok(await search(query)); } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'stock_quote',
    {
      title: 'Live quote for one symbol',
      description:
        'Current price, percent change, day range, 52-week range and volume for one ticker. ' +
        'Works for stocks, ETFs, indices (^GSPC) and crypto pairs (BTC-USD). ' +
        'Use this for "how is X doing" or anything about a price right now.',
      inputSchema: { symbol: z.string().describe('ticker symbol, e.g. "NVDA"') },
    },
    async ({ symbol }) => {
      try { return ok(await quote(symbol)); } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'stock_history',
    {
      title: 'Price history for one symbol',
      description:
        'OHLC bars over a period, plus the total percent change across it. ' +
        'Use this to talk about a trend rather than a single price — "how has it done this year".',
      inputSchema: {
        symbol: z.string().describe('ticker symbol'),
        range: z.enum(RANGES).optional().describe('lookback window, default "6mo"'),
        interval: z.enum(INTERVALS).optional().describe('bar size, default "1wk"'),
        limit: z.number().optional().describe('most recent bars to return, 1-60, default 30'),
      },
    },
    async ({ symbol, range, interval, limit }) => {
      try { return ok(await history(symbol, range ?? '6mo', interval ?? '1wk', limit ?? 30)); }
      catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'market_snapshot',
    {
      title: 'How the market is doing right now',
      description:
        `The headline indices at once: ${MARKET_INDICES.map((i) => i.label).join(', ')}. ` +
        'Use this for "how is the market", "is it a red day", or to open a conversation about markets.',
      inputSchema: {},
    },
    async () => { try { return ok(await marketSnapshot()); } catch (e) { return fail(e); } },
  );

  server.registerTool(
    'company_fundamentals',
    {
      title: 'Official financials from SEC filings',
      description:
        'Revenue, net income, assets, liabilities and cash for a US-listed company, taken from its ' +
        'annual 10-K as filed with the SEC. These are official numbers, not estimates — prefer this ' +
        'over anything you recall when discussing how a business actually performs.',
      inputSchema: { symbol: z.string().describe('ticker symbol of a US-listed filer, e.g. "AAPL"') },
    },
    async ({ symbol }) => {
      try { return ok(await fundamentals(symbol)); } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'company_filings',
    {
      title: 'Recent SEC filings',
      description:
        'Recent 10-K, 10-Q, 8-K and proxy filings for a US-listed company, newest first, with links. ' +
        'Use this for "has anything happened at X lately" — an 8-K means something did.',
      inputSchema: {
        symbol: z.string().describe('ticker symbol'),
        limit: z.number().optional().describe('filings to return, 1-25, default 10'),
      },
    },
    async ({ symbol, limit }) => {
      try { return ok(await filings(symbol, limit ?? 10)); } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    'fx_rate',
    {
      title: 'Currency exchange rate',
      description: 'Reference exchange rate between two currencies, from the European Central Bank.',
      inputSchema: {
        from: z.string().describe('ISO currency code, e.g. "USD"'),
        to: z.string().describe('ISO currency code, e.g. "EUR"'),
      },
    },
    async ({ from, to }) => {
      try { return ok(await fxRate(from, to)); } catch (e) { return fail(e); }
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

app.get('/health', (_req, res) => res.json({ ok: true, tools: 7, keys_required: 0 }));

app.listen(PORT, () => {
  console.log(`wall-street MCP on http://localhost:${PORT}/mcp  (7 tools, no API keys)`);
});
