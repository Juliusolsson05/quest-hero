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

const sessions = new Map<string, string>();

/** Cached so we resolve the model once per page load, not once per NPC. */
let modelPromise: Promise<string> | null = null;

/**
 * AgentSpec requires a model, and hardcoding a catalog id ("openai/gpt-5.2")
 * guesses at something the harness already knows. Ask it what is configured
 * and take the first — the game then works with whichever provider the user
 * set up, and says something useful when they have set up none.
 */
async function resolveModel(): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/models`);
  if (!res.ok) throw new HarnessUnavailable(`models: ${res.status}`);
  const models: { name?: string }[] = (await res.json())?.data ?? [];
  const name = models[0]?.name;
  if (!name) {
    throw new HarnessUnavailable(
      'no model configured in TrueForge — add a provider at http://localhost:8790 (Settings -> Models)',
    );
  }
  return name;
}

export class HarnessUnavailable extends Error {}

async function sessionFor(npc: NpcDef): Promise<string> {
  const existing = sessions.get(npc.id);
  if (existing) return existing;

  modelPromise ??= resolveModel();
  const model = await modelPromise;

  const res = await fetch(`${BASE}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: { spec: { model: { name: model }, instructions: npc.persona } },
      metadata: { npc: npc.id, name: npc.name },
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
