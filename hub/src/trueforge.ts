/**
 * The TrueForge client — the ONLY file in the repo that speaks to the agent
 * harness. Model/connector discovery (60s caches), one session per key kept
 * for the run (that persistence IS an NPC's memory), and SSE turn streaming
 * with tool-call badges.
 *
 * TrueForge contract (verified against the live 0.2.0-rc.0 server):
 *   POST /api/v1/sessions        {agent:{spec:{model:{name},instructions,mcp_servers?}}}
 *                                → session id at body.data.id (no metadata key!)
 *   GET  /api/v1/models          → {data:[{name}]} configured chat models
 *   GET  /api/v1/mcp-servers     → {data:[{name,auth_status:{status}}]}
 *   POST /api/v1/sessions/:id/turns?stream=true
 *                                → SSE: model.message.delta (.content and/or
 *                                  .tool_calls fragments), mcp.initialize,
 *                                  tool.response, turn.done
 */
import { CONFIG } from './config';
import { warnOnce } from './util';

const BASE = CONFIG.trueforgeBase;

export class HarnessUnavailable extends Error {}

// ── model + connector discovery (60s caches, re-checked per session create) ─

let modelCache: { at: number; names: string[] } | null = null;

async function configuredModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 60_000) return modelCache.names;
  const res = await fetch(`${BASE}/api/v1/models`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new HarnessUnavailable(`models: ${res.status}`);
  const body = (await res.json()) as { data?: { name?: string }[] };
  const names = (body?.data ?? []).map((m) => m.name).filter((n): n is string => !!n);
  modelCache = { at: Date.now(), names };
  return names;
}

/** env TRUEFORGE_MODEL wins; else the NPC's preference if configured; else the
 *  first catalog entry; an empty catalog routes straight to canned fallbacks. */
export async function resolveModel(preferred?: string): Promise<string> {
  if (CONFIG.trueforgeModel) return CONFIG.trueforgeModel;
  const names = await configuredModels();
  if (preferred && names.includes(preferred)) return preferred;
  if (names[0]) return names[0];
  warnOnce(
    'trueforge-nomodel',
    '[dialogue] TrueForge has no model configured — paste a key in Settings → Models; serving canned lines',
  );
  throw new HarnessUnavailable('no model configured');
}

/** Web connectors in the shipped catalog, matched against what the harness has
 *  configured AND authenticated, in catalog preference order. */
const WEB_CONNECTORS = ['bright-data', 'tavily', 'exa', 'parallel-web'];

let connectorCache: { at: number; names: string[] } | null = null;

/** Every authenticated connector TrueForge has configured (unfiltered). */
async function configuredConnectors(): Promise<string[]> {
  if (connectorCache && Date.now() - connectorCache.at < 60_000) return connectorCache.names;
  const res = await fetch(`${BASE}/api/v1/mcp-servers`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new HarnessUnavailable(`connectors: ${res.status}`);
  const body = (await res.json()) as { data?: { name?: string; auth_status?: { status?: string } }[] };
  const names = (body?.data ?? [])
    .filter((s) => s.name && ['authenticated', 'not_required'].includes(s.auth_status?.status ?? 'authenticated'))
    .map((s) => s.name!);
  connectorCache = { at: Date.now(), names };
  return names;
}

// ── sessions ────────────────────────────────────────────────────────────────

const sessions = new Map<string, string>();

export interface SessionSpec {
  persona: string;
  model?: string;
  webAccess?: boolean;
  /** Extra MCP connector names to attach verbatim (deduped against webAccess
   *  ones; silently dropped if TrueForge doesn't have them configured). */
  connectors?: string[];
}

export async function sessionFor(key: string, spec: SessionSpec, signal: AbortSignal): Promise<string> {
  const existing = sessions.get(key);
  if (existing) return existing;

  const model = await resolveModel(spec.model);
  let connectors: string[] = [];
  if (spec.webAccess || spec.connectors?.length) {
    try {
      const configured = await configuredConnectors();
      if (spec.webAccess) {
        connectors = configured
          .filter((n) => WEB_CONNECTORS.includes(n))
          .sort((a, b) => WEB_CONNECTORS.indexOf(a) - WEB_CONNECTORS.indexOf(b));
      }
      for (const want of spec.connectors ?? []) {
        if (configured.includes(want) && !connectors.includes(want)) connectors.push(want);
      }
    } catch {
      warnOnce('trueforge-mcp', '[dialogue] could not list TrueForge mcp-servers — talking without web tools');
    }
  }

  const res = await fetch(`${BASE}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      agent: {
        spec: {
          model: { name: model },
          instructions: spec.persona,
          ...(connectors.length ? { mcp_servers: connectors.map((name) => ({ name })) } : {}),
        },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HarnessUnavailable(`create session: ${res.status} ${detail}`.slice(0, 200));
  }
  const body = (await res.json()) as { data?: { id?: string }; id?: string };
  const id = body?.data?.id ?? body?.id;
  if (!id) throw new HarnessUnavailable('no session id in response');
  sessions.set(key, id);
  return id;
}

// ── turn streaming (SSE) ────────────────────────────────────────────────────

interface ToolCallAcc {
  id: string;
  name: string;
  args: string;
  system: boolean;
  bubbled: boolean;
}

export interface TurnCallbacks {
  onDelta: (chunk: string) => void;
  /** one badge per real tool call: name or "tool: query…" once args parse */
  onTool?: (label: string) => void;
}

function toolDetail(c: ToolCallAcc): string | null {
  if (!c.args) return null;
  try {
    const o = JSON.parse(c.args) as Record<string, unknown> & { arguments?: Record<string, unknown> };
    const label = (o.tool ?? o.name ?? c.name ?? 'tool') as string;
    const query = (o.query ?? o.arguments?.query ?? o.input) as string | undefined;
    return String(query ? `${label}: ${query}` : label).slice(0, 60);
  } catch {
    return null; // partial JSON — wait for more fragments
  }
}

export async function streamTurn(sessionId: string, content: string, cb: TurnCallbacks, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns?stream=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ input: [{ type: 'user.message', content }] }),
    signal,
  });
  if (!res.ok || !res.body) throw new HarnessUnavailable(`turn: ${res.status}`);

  const calls = new Map<string, ToolCallAcc>();
  const indexToId = new Map<number, string>();

  // A call whose args never parsed still deserves its one badge before text
  // resumes (or when its response lands) — name-only is better than silence.
  const flushPending = () => {
    for (const c of calls.values()) {
      if (c.bubbled || c.system) continue;
      c.bubbled = true;
      cb.onTool?.(toolDetail(c) ?? (c.name || 'consulting tools'));
    }
  };

  const handleEvent = (evt: Record<string, any>): void => {
    if (evt?.type === 'mcp.initialize') {
      const names = (Array.isArray(evt.mcp_servers) ? evt.mcp_servers : [])
        .map((s: { name?: string }) => s?.name)
        .filter(Boolean);
      if (names.length) cb.onTool?.(`connecting: ${names.join(', ')}`);
      return;
    }
    if (evt?.type === 'tool.response') {
      flushPending(); // call finished — deltas resume, no badge for the response itself
      return;
    }
    if (evt?.type !== 'model.message.delta') return;

    if (Array.isArray(evt.tool_calls)) {
      for (const tc of evt.tool_calls) {
        // only the FIRST fragment of a call carries id; later ones identify by index
        let id: string | undefined = tc?.id;
        if (id !== undefined && typeof tc?.index === 'number') indexToId.set(tc.index, id);
        if (id === undefined && typeof tc?.index === 'number') id = indexToId.get(tc.index);
        if (!id) continue;
        let acc = calls.get(id);
        if (!acc) {
          acc = { id, name: '', args: '', system: false, bubbled: false };
          calls.set(id, acc);
        }
        if (tc?.function?.name) acc.name = tc.function.name;
        if (typeof tc?.function?.arguments === 'string') acc.args += tc.function.arguments;
        if (tc?.tool_info?.type === 'truefoundry-system') acc.system = true;
        if (!acc.system && !acc.bubbled) {
          const detail = toolDetail(acc);
          if (detail) {
            acc.bubbled = true;
            cb.onTool?.(detail);
          }
        }
      }
    }
    if (typeof evt.content === 'string' && evt.content) {
      flushPending();
      cb.onDelta(evt.content);
    }
  };

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!data || data === '[DONE]') continue;
      try {
        handleEvent(JSON.parse(data));
      } catch {
        // an unparseable frame is not worth killing the conversation over
      }
    }
  }
}
