import type { NpcDef } from './npc';

/**
 * Thin client for the TrueForge harness.
 *
 * Talks to the REST surface directly rather than through @truefoundry/trueforge-sdk
 * because the browser needs to stream a turn into a dialogue box and nothing
 * else; pulling the full SDK in for one endpoint would cost bundle size we
 * spend better elsewhere. The shapes below mirror the SDK's.
 *
 * One session per NPC, created lazily on first conversation and kept for the
 * run — that persistence IS the character's memory. A fresh session per line
 * would give us a goldfish that reintroduces itself every time you walk up.
 */

// Same-origin by default: vite.config.ts proxies /api/v1 to the harness,
// because TrueForge sends no CORS headers and a direct cross-origin
// fetch from the browser fails opaquely.
const BASE = import.meta.env.VITE_TRUEFORGE_URL ?? '';

/** Raised for every reason an NPC cannot answer, carrying the specific cause
 *  so the dialogue box can show it rather than a generic failure. */
export class HarnessUnavailable extends Error {}

const sessions = new Map<string, string>();

/** Cached so we resolve the model once per page load, not once per NPC. */
let modelPromise: Promise<string[]> | null = null;

/** Lists the model FQNs the harness actually has configured. Characters name
 *  a preferred model, but the machine decides what exists, so selection is a
 *  negotiation between the two rather than a hardcoded id. */
async function configuredModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/v1/models`);
  if (!res.ok) throw new HarnessUnavailable(`models: ${res.status}`);
  const models: { name?: string }[] = (await res.json())?.data ?? [];
  return models.map((m) => m.name).filter((n): n is string => !!n);
}

/**
 * Connectors in the shipped catalog that answer questions about the world
 * outside the game. Matched by name against what is configured, so a provider
 * added in Settings is picked up on the next reload without a code change —
 * which is the point: the data pipeline should live inside the agent workflow,
 * not beside it in a hardcoded list that goes stale.
 */
const WEB_CONNECTORS = ['bright-data', 'tavily', 'exa', 'parallel-web'];

let connectorPromise: Promise<string[]> | null = null;

/** Names of configured web connectors that are actually usable. An unauthenticated
 *  server would be attached and then fail mid-conversation, which is worse than
 *  not offering it at all. */
async function webConnectors(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/v1/mcp-servers`);
  if (!res.ok) throw new HarnessUnavailable(`connectors: ${res.status}`);
  const servers: { name?: string; auth_status?: { status?: string } }[] =
    (await res.json())?.data ?? [];
  return servers
    .filter((s) => s.name && WEB_CONNECTORS.includes(s.name))
    .filter((s) => (s.auth_status?.status ?? 'authenticated') === 'authenticated')
    .map((s) => s.name!)
    // Catalog order, so a character prefers the richer scraping provider when
    // both are present rather than depending on API response ordering.
    .sort((a, b) => WEB_CONNECTORS.indexOf(a) - WEB_CONNECTORS.indexOf(b));
}

async function sessionFor(npc: NpcDef): Promise<string> {
  const existing = sessions.get(npc.id);
  if (existing) return existing;

  modelPromise ??= configuredModels();
  const available = await modelPromise;
  const model = available.includes(npc.model) ? npc.model : available[0];

  // Resolved once per page load and shared, since it is a property of the
  // harness rather than of any one character.
  let connectors: string[] = [];
  if (npc.webAccess) {
    connectorPromise ??= webConnectors();
    connectors = await connectorPromise;
  }

  if (!model) {
    throw new HarnessUnavailable(
      'no model configured in TrueForge — add a provider at http://localhost:8790 (Settings -> Models)',
    );
  }

  const res = await fetch(`${BASE}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: {
        spec: {
          model: { name: model },
          instructions: npc.persona,
          ...(connectors.length ? { mcp_servers: connectors.map((name) => ({ name })) } : {}),
        },
      },
    }),
  });
  if (!res.ok) throw new HarnessUnavailable(`create session: ${res.status} ${await res.text()}`);

  const body = await res.json();
  const id = body?.data?.id ?? body?.id;
  if (!id) throw new HarnessUnavailable('no session id in response');
  sessions.set(npc.id, id);
  return id;
}

/**
 * Sends one player line and yields text as it arrives, so dialogue types out
 * instead of appearing after a silent pause. onDelta is called per chunk.
 */
export async function say(
  npc: NpcDef,
  line: string,
  onDelta: (text: string) => void,
): Promise<void> {
  const id = await sessionFor(npc);
  const res = await fetch(`${BASE}/api/v1/sessions/${id}/turns?stream=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ input: [{ type: 'user.message', content: line }] }),
  });
  if (!res.ok || !res.body) throw new HarnessUnavailable(`turn: ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line; hold the trailing partial.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'model.message.delta' && evt.content) onDelta(evt.content);
      } catch {
        // A frame we cannot parse is not worth killing the conversation over.
      }
    }
  }
}
