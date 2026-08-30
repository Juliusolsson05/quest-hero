/**
 * Boot-time TrueForge provisioning, driven entirely by env: the hosted world
 * must configure its own harness because the deployment never exposes the
 * TrueForge UI — standalone TrueForge has no auth, so it lives loopback-only
 * beside the hub and nobody can open Settings on it.
 *
 * Every write is a create-or-replace PUT, so re-running is harmless; every
 * failure is a warning, never a crash — the hub's dialogue layer already
 * degrades to canned lines when the harness has nothing configured. With no
 * env set this is a no-op, which is what keeps local dev on whatever the
 * developer configured by hand.
 */
import { CONFIG } from './config';

/**
 * Mirrors the model set the dev harness runs. NPC seeds reference models by
 * FQN ("openai/gpt-5-5" = provider-name/model-name), so these names must not
 * drift from npcs.ts without changing both.
 */
const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'];
const OPENAI_MODELS = [
  { model_id: 'gpt-5.4-mini', name: 'gpt-5-4-mini', properties: { context_length: 400_000, max_output_tokens: 128_000, reasoning_efforts: EFFORTS } },
  { model_id: 'gpt-5.5', name: 'gpt-5-5', properties: { context_length: 1_050_000, max_output_tokens: 128_000, reasoning_efforts: EFFORTS } },
  { model_id: 'gpt-5.6-luna', name: 'gpt-5-6-luna', properties: { context_length: 1_050_000, max_output_tokens: 128_000, reasoning_efforts: [...EFFORTS, 'max'] } },
  { model_id: 'gpt-5.6-sol', name: 'gpt-5-6-sol', properties: { context_length: 1_050_000, max_output_tokens: 128_000, reasoning_efforts: [...EFFORTS, 'max'] } },
  { model_id: 'gpt-5.6-terra', name: 'gpt-5-6-terra', properties: { context_length: 1_050_000, max_output_tokens: 128_000, reasoning_efforts: [...EFFORTS, 'max'] } },
];

async function put(path: string, manifest: unknown, what: string): Promise<void> {
  try {
    const res = await fetch(`${CONFIG.trueforgeBase}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest }),
    });
    if (res.ok) {
      console.log(`[seed] ${what}: ok`);
    } else {
      const body = await res.text().catch(() => '');
      console.warn(`[seed] ${what}: HTTP ${res.status} ${body}`.slice(0, 300));
    }
  } catch (e) {
    console.warn(`[seed] ${what}: ${e instanceof Error ? e.message : e}`);
  }
}

export async function seedTrueForge(): Promise<void> {
  const jobs: Promise<void>[] = [];

  if (process.env.OPENAI_API_KEY) {
    jobs.push(put(
      '/api/v1/settings/model-providers',
      { type: 'openai', auth: { api_key: process.env.OPENAI_API_KEY }, models: OPENAI_MODELS },
      'model provider openai',
    ));
  }

  const origin = (process.env.GAME_ORIGIN ?? '').replace(/\/+$/, '');
  if (origin) {
    jobs.push(put(
      '/api/v1/settings/mcp-servers',
      {
        type: 'remote',
        name: 'sf-guide',
        url: `${origin}/api/mcp/sf-guide`,
        description:
          'Live San Francisco city data: DataSF open datasets plus real-time weather, air quality, earthquakes, tides, bike share and landmarks.',
      },
      'mcp sf-guide',
    ));
    jobs.push(put(
      '/api/v1/settings/mcp-servers',
      {
        type: 'remote',
        name: 'wall-street',
        url: `${origin}/api/mcp/wall-street`,
        description:
          'Live stock market data: quotes, price history, market indices, official SEC filings and fundamentals, and FX rates.',
      },
      'mcp wall-street',
    ));
  }

  if (process.env.BRIGHT_DATA_API_TOKEN) {
    // Name must stay 'bright-data': it is first in trueforge.ts WEB_CONNECTORS,
    // so every webAccess NPC picks it up as their primary web search the
    // moment it exists. Hosted endpoint verified to accept Bearer auth.
    jobs.push(put(
      '/api/v1/settings/mcp-servers',
      {
        type: 'remote',
        name: 'bright-data',
        url: 'https://mcp.brightdata.com/mcp',
        description:
          'Bright Data live web access: search_engine for fresh results, scrape_as_markdown to read a page in full.',
        auth: { type: 'header', headers: { Authorization: `Bearer ${process.env.BRIGHT_DATA_API_TOKEN}` } },
      },
      'mcp bright-data',
    ));
  }

  if (process.env.TAVILY_API_KEY) {
    jobs.push(put(
      '/api/v1/settings/mcp-servers',
      {
        type: 'remote',
        name: 'tavily',
        url: 'https://mcp.tavily.com/mcp',
        description: 'Tavily web search — word from beyond the village.',
        auth: { type: 'header', headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` } },
      },
      'mcp tavily',
    ));
  }

  if (jobs.length === 0) return;
  console.log(`[seed] provisioning TrueForge at ${CONFIG.trueforgeBase} (${jobs.length} resources)`);
  await Promise.all(jobs);
}
