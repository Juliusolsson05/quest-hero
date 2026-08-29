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

/** What the dialogue box needs to know about a turn as it happens. */
export type TurnEvent =
  | { kind: 'text'; text: string }
  | { kind: 'connect'; servers: string[] }
  | { kind: 'tool'; id: string; name: string; detail: string; system: boolean; done: boolean };

/**
 * Turns `call_tool`'s streamed argument JSON into something a player can read.
 *
 * Arguments arrive as string fragments across many deltas, so this is called
 * repeatedly with a partial buffer and must tolerate invalid JSON rather than
 * throw — the detail simply sharpens as more of the argument arrives.
 */
function describeArgs(args: string): string {
  try {
    const o = JSON.parse(args);
    // The harness wraps MCP calls: the tool the player cares about is named
    // inside the arguments, not in the function name.
    const tool = o.tool ?? o.name ?? o.tool_name;
    const query = o.query ?? o.arguments?.query ?? o.args?.query ?? o.input;
    if (tool && query) return `${tool}: ${String(query).slice(0, 60)}`;
    if (tool) return String(tool);
    if (query) return String(query).slice(0, 60);
  } catch {
    // Partial JSON mid-stream is expected, not an error.
  }
  return '';
}

/**
 * Sends one player line and reports the turn as it unfolds — text, MCP
 * connections, and every tool call with its result. The dialogue box renders
 * all of it, because an agent that visibly reaches for a tool is far more
 * legible than one that pauses and then knows things.
 */
export async function say(
  npc: NpcDef,
  line: string,
  onEvent: (e: TurnEvent) => void,
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
  const calls = new Map<string, { name: string; args: string; system_type?: string }>();
  const byIndex = new Map<number, string>();
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

        if (evt.type === 'mcp.initialize') {
          const servers = (evt.mcp_servers ?? []).map((s: { name: string }) => s.name);
          if (servers.length) onEvent({ kind: 'connect', servers });
        }

        if (evt.type === 'model.message.delta') {
          if (evt.content) onEvent({ kind: 'text', text: evt.content });

          for (const tc of evt.tool_calls ?? []) {
            // Only the first fragment of a call carries its id; later ones are
            // identified by index alone, so the mapping has to be remembered.
            const id = tc.id ?? byIndex.get(tc.index);
            if (!id) continue;
            if (tc.id !== undefined) byIndex.set(tc.index, tc.id);

            const prev = calls.get(id);
            const name = tc.function?.name || prev?.name || 'tool';
            const args = (prev?.args ?? '') + (tc.function?.arguments ?? '');
            const system = (tc.tool_info?.type ?? prev?.system_type) === 'truefoundry-system';
            calls.set(id, { name, args, system_type: tc.tool_info?.type ?? prev?.system_type });
            onEvent({ kind: 'tool', id, name, detail: describeArgs(args), system, done: false });
          }
        }

        if (evt.type === 'tool.response') {
          const done = calls.get(evt.tool_call_id);
          if (done) {
            onEvent({
              kind: 'tool',
              id: evt.tool_call_id,
              name: done.name,
              detail: describeArgs(done.args),
              system: done.system_type === 'truefoundry-system',
              done: true,
            });
          }
        }
      } catch {
        // A frame we cannot parse is not worth killing the conversation over.
      }
    }
  }
}
