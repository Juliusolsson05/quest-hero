/**
 * The TrueForge layer, on the official SDK (@truefoundry/trueforge-sdk) —
 * no hand-rolled fetch/SSE anywhere. This module owns everything that talks
 * to the harness; dialogue.ts and chatter.ts sit on top of it.
 *
 * Native features in play (docs/trueforge/):
 *  - Named agents: every character is saved into the Agent Library via
 *    agents.create/update, so the whole cast is visible, editable, and
 *    "Try"-able in the TrueForge UI. Sessions reference agents by name.
 *  - Sessions + turn chaining: one session per character = its memory.
 *    Session ids persist to hub/.trueforge-sessions.json so an NPC still
 *    remembers you after a hub restart (TrueForge keeps the history).
 *  - Streaming with the SDK's event index: isEventDelta/mergeEventDelta,
 *    per the documented id-keyed pattern.
 *  - Subagents: dynamic_sub_agents on; thread.created surfaces in-game.
 *  - Pauses: ask_user_question and tool approvals come back as
 *    PendingActions the dialogue broker turns into diegetic bubbles, and
 *    resume as user.tool_response / user.tool_approval turn input.
 *  - Deferred tool loading (preload off) with one selective preload:
 *    sf-guide's sf_live_conditions, because weather is the #1 question.
 *  - response_format json_object for the JSON-emitting agents (Quest
 *    Scribe, the chatter writers) instead of regex-rescuing prose.
 *  - Generative UI is disabled on purpose: replies render in plain-text
 *    kawaii bubbles, where OpenUI blocks would be noise.
 *  - Sandbox/skills stay off: no sandbox provider is configured (Daytona
 *    key required); enabling them is a one-field change here if that lands.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrueForge, TrueForgeApi, isEventDelta, mergeEventDelta } from '@truefoundry/trueforge-sdk';
import { CONFIG } from './config';
import { warnOnce } from './util';

export class HarnessUnavailable extends Error {}

export const forge = new TrueForge({
  baseUrl: CONFIG.trueforgeBase,
  timeoutInSeconds: 600, // long-running SSE turns; the dialogue watchdog is stricter
});

// ── discovery: models + connectors (60s caches, fail-soft) ──────────────────

let modelCache: { at: number; names: string[] } | null = null;

async function configuredModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 60_000) return modelCache.names;
  const res = await forge.models.list().catch((e) => {
    throw new HarnessUnavailable(`models: ${e instanceof Error ? e.message : e}`);
  });
  modelCache = { at: Date.now(), names: res.data.map((m) => m.name) };
  return modelCache.names;
}

/** env TRUEFORGE_MODEL wins; else the agent's preference if configured; else
 *  the first catalog entry; an empty catalog routes to canned fallbacks. */
export async function resolveModel(preferred?: string): Promise<string> {
  if (CONFIG.trueforgeModel) return CONFIG.trueforgeModel;
  const names = await configuredModels();
  if (preferred && names.includes(preferred)) return preferred;
  if (names[0]) return names[0];
  warnOnce(
    'forge-nomodel',
    '[harness] TrueForge has no model configured — paste a key in Settings → Models; serving canned lines',
  );
  throw new HarnessUnavailable('no model configured');
}

/** Connectors a webAccess agent gets, in preference order, matched against
 *  what TrueForge actually has configured AND authenticated. */
export const WEB_CONNECTORS = ['bright-data', 'tavily', 'exa', 'parallel-web', 'sf-guide', 'wall-street'];

let connectorCache: { at: number; names: string[] } | null = null;

async function configuredConnectors(): Promise<string[]> {
  if (connectorCache && Date.now() - connectorCache.at < 60_000) return connectorCache.names;
  const res = await forge.mcpServers.list().catch((e) => {
    throw new HarnessUnavailable(`mcp-servers: ${e instanceof Error ? e.message : e}`);
  });
  connectorCache = {
    at: Date.now(),
    names: res.data
      .filter((s) => ['authenticated', 'not_required'].includes(s.authStatus?.status ?? ''))
      .map((s) => s.name),
  };
  return connectorCache.names;
}

// ── agent definitions → agent specs ─────────────────────────────────────────

export interface AgentDef {
  /** Agent Library name; when set the agent is saved/updated in the registry
   *  and sessions reference it by name (inline spec otherwise). */
  registryName?: string;
  persona: string;
  /** preferred model FQN; the catalog decides what actually exists */
  model?: string;
  /** attach the standard web connector set (whatever is configured) */
  webAccess?: boolean;
  /** extra connector names attached verbatim when configured */
  connectors?: string[];
  /** force strict JSON output (response_format json_object) */
  json?: boolean;
  /** allow the harness to fan out to parallel subagents (default true) */
  subagents?: boolean;
}

async function buildManifest(def: AgentDef): Promise<TrueForgeApi.AgentSpec> {
  const model = await resolveModel(def.model);
  let names: string[] = [];
  if (def.webAccess || def.connectors?.length) {
    try {
      const configured = await configuredConnectors();
      if (def.webAccess) {
        names = configured
          .filter((n) => WEB_CONNECTORS.includes(n))
          .sort((a, b) => WEB_CONNECTORS.indexOf(a) - WEB_CONNECTORS.indexOf(b));
      }
      for (const want of def.connectors ?? []) {
        if (configured.includes(want) && !names.includes(want)) names.push(want);
      }
    } catch {
      warnOnce('forge-mcp', '[harness] could not list TrueForge mcp-servers — agents run without web tools');
    }
  }
  return {
    model: { name: model },
    instructions: def.persona,
    ...(names.length
      ? {
          mcpServers: names.map((name): TrueForgeApi.McpServer =>
            // Deferred tool loading everywhere (the native default), with one
            // selective preload: current SF weather is asked constantly.
            name === 'sf-guide' ? { name, preloadTools: ['sf_live_conditions'] } : { name },
          ),
        }
      : {}),
    config: {
      generativeUi: { enabled: false }, // bubbles are plain text
      askUserQuestions: { enabled: true }, // pauses become diegetic questions
      dynamicSubAgents: { enabled: def.subagents ?? true },
      sandbox: { enabled: false }, // no sandbox provider configured (Daytona)
      iterationLimit: 40, // dialogue should stay snappy
    },
    ...(def.json ? { responseFormat: { type: 'json_object' } } : {}),
  };
}

// ── the Agent Library (named agents) ────────────────────────────────────────

let registryIds: Map<string, string> | null = null;
const ensured = new Set<string>();

async function agentRegistry(): Promise<Map<string, string>> {
  if (!registryIds) {
    const res = await forge.agents.list();
    registryIds = new Map(res.data.map((a) => [a.name, a.id]));
  }
  return registryIds;
}

/**
 * Save (or refresh) a named agent in the TrueForge Agent Library so this
 * character exists as a first-class agent — visible, editable, and runnable
 * from the TrueForge UI too. Once per hub run per agent; the code is the
 * source of truth, so an existing entry is updated to match.
 */
export async function ensureAgent(def: AgentDef): Promise<string> {
  const name = def.registryName;
  if (!name) throw new HarnessUnavailable('ensureAgent needs a registryName');
  if (ensured.has(name)) return name;
  const manifest = await buildManifest(def);
  const registry = await agentRegistry();
  const existing = registry.get(name);
  if (existing) {
    await forge.agents.update(existing, { manifest });
  } else {
    try {
      const res = await forge.agents.create({ name, manifest });
      registry.set(name, res.data.id);
    } catch (e) {
      // Likely a create race / stale cache: re-list and update instead.
      registryIds = null;
      const fresh = await agentRegistry();
      const id = fresh.get(name);
      if (!id) throw e;
      await forge.agents.update(id, { manifest });
    }
  }
  ensured.add(name);
  return name;
}

// ── sessions (persisted so NPC memory survives hub restarts) ────────────────

const here = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(here, '..', '.trueforge-sessions.json');

const sessions: Map<string, string> = (() => {
  try {
    if (existsSync(SESSIONS_FILE)) {
      return new Map(Object.entries(JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, string>));
    }
  } catch {
    /* a corrupt cache just means fresh sessions */
  }
  return new Map();
})();

function persistSessions(): void {
  try {
    writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch {
    /* memory-only is fine */
  }
}

/** Drop a stored session (e.g. TrueForge no longer knows it) so the next
 *  turn creates a fresh one. */
export function forgetSession(key: string): void {
  if (sessions.delete(key)) persistSessions();
}

/**
 * The session for a character/agent key — created on first use, kept for
 * good. That persistence IS the character's memory: TrueForge chains every
 * turn in the session, so nothing is ever resent.
 */
export async function sessionFor(key: string, def: AgentDef, signal?: AbortSignal): Promise<string> {
  const existing = sessions.get(key);
  if (existing) return existing;

  let agent: TrueForgeApi.CreateSessionAgent;
  if (def.registryName) {
    try {
      agent = { name: await ensureAgent(def) };
    } catch (e) {
      // The registry failing must not silence a character — run inline.
      warnOnce('forge-registry', `[harness] agent registry unavailable (${e instanceof Error ? e.message : e}) — using inline specs`);
      agent = { spec: await buildManifest(def) };
    }
  } else {
    agent = { spec: await buildManifest(def) };
  }

  const res = await forge.sessions
    .create({ agent }, { abortSignal: signal })
    .catch((e) => {
      throw new HarnessUnavailable(`create session: ${e instanceof Error ? e.message : e}`.slice(0, 200));
    });
  sessions.set(key, res.data.id);
  persistSessions();
  return res.data.id;
}

// ── turns ───────────────────────────────────────────────────────────────────

export interface TurnCallbacks {
  /** root-agent ("main" thread) text as it streams */
  onDelta: (chunk: string) => void;
  /** one badge per real tool call — "tool: query…" once the args parse */
  onTool?: (label: string) => void;
  /** a subagent thread spun up (its text stays out of the bubble) */
  onThread?: (title: string) => void;
  /** any stream activity at all — the caller's stall watchdog */
  onEvent?: () => void;
}

/** A turn ended paused: the agent needs something from the player. */
export interface PendingAction {
  kind: 'approval' | 'question';
  threadId: string;
  toolCallId: string;
  toolName: string;
  args: string;
  /** parsed from ask_user_question arguments when present */
  question?: string;
  options?: string[];
}

export interface TurnResult {
  text: string;
  pending: PendingAction[];
  /** MCP servers that need OAuth before the agent can continue */
  authRequired: { name: string; url: string }[];
  metrics?: TrueForgeApi.TurnMetrics;
}

/** Text content of a model message (string, or joined text parts). */
function contentToText(content: TrueForgeApi.ModelMessageEventContent | null | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => ('text' in part ? part.text : '')).join('');
}

function toolLabel(call: TrueForgeApi.ToolCall): string | null {
  const args = call.function?.arguments ?? '';
  if (!args) return null;
  try {
    const o = JSON.parse(args) as Record<string, unknown> & { arguments?: Record<string, unknown> };
    const label = String(o.tool ?? o.name ?? call.function?.name ?? call.toolInfo?.name ?? 'tool');
    const query = (o.query ?? o.arguments?.query ?? o.input) as string | undefined;
    return String(query ? `${label}: ${query}` : label).slice(0, 60);
  } catch {
    return null; // partial JSON — wait for more fragments
  }
}

/**
 * One turn: send `input`, stream events through the documented id-keyed
 * event index (deltas merged with the SDK helpers), and return the final
 * text plus anything the turn is waiting on. Throws HarnessUnavailable on
 * cancelled/error terminals so callers can serve canned fallbacks.
 */
export async function streamTurn(
  sessionId: string,
  input: TrueForgeApi.TurnInputItem[],
  cb: TurnCallbacks,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const stream = await forge.sessions
    .createTurnStream(sessionId, { input }, { abortSignal: signal })
    .catch((e) => {
      throw new HarnessUnavailable(`turn: ${e instanceof Error ? e.message : e}`.slice(0, 200));
    });

  const events = new Map<string, TrueForgeApi.TurnStreamingEvent>();
  const badged = new Set<string>();
  let done: TrueForgeApi.TurnDoneEventState | null = null;
  let mainText = '';

  /** Badge every completed (non-system) tool call on this message once. */
  const badgeCalls = (msg: TrueForgeApi.ModelMessageEvent, force = false): void => {
    for (const call of msg.toolCalls ?? []) {
      if (!call.id || badged.has(call.id)) continue;
      if (call.toolInfo?.type === 'truefoundry-system') continue;
      const label = toolLabel(call) ?? (force ? call.toolInfo?.name ?? call.function?.name ?? 'consulting tools' : null);
      if (!label) continue;
      badged.add(call.id);
      cb.onTool?.(label);
    }
  };

  for await (const { data: event } of stream.withMetadata()) {
    cb.onEvent?.();
    if (isEventDelta(event)) {
      const base = events.get(event.id);
      if (base) mergeEventDelta(base, event);
      if (event.threadId === 'main' && typeof event.content === 'string' && event.content) {
        mainText += event.content;
        cb.onDelta(event.content);
      }
      if (base?.type === 'model.message' && base.threadId === 'main') badgeCalls(base);
      continue;
    }
    events.set(event.id, event);
    switch (event.type) {
      case 'mcp.initialize': {
        const names = event.mcpServers.map((s) => s.name).filter(Boolean);
        if (names.length) cb.onTool?.(`connecting: ${names.join(', ')}`);
        break;
      }
      case 'thread.created':
        cb.onThread?.(event.title);
        break;
      case 'tool.response': {
        // A call whose args never parsed still deserves its name-only badge.
        for (const e of events.values()) {
          if (e.type === 'model.message' && e.threadId === 'main') badgeCalls(e, true);
        }
        break;
      }
      case 'turn.done':
        done = event.state;
        break;
    }
  }

  if (!done) throw new HarnessUnavailable('stream ended without turn.done');
  if (done.status === 'cancelled') throw new HarnessUnavailable(`turn cancelled (${done.reason})`);
  if (done.status === 'error') throw new HarnessUnavailable(`turn error: ${done.message}`.slice(0, 200));

  // Pauses: map each pending ref through the event index to the tool call
  // that raised it, exactly as the SDK docs prescribe (sourceEventId).
  const pending: PendingAction[] = [];
  const authRequired: TurnResult['authRequired'] = [];
  for (const action of done.requiredActions ?? []) {
    if (action.type === 'mcp.auth_required') {
      for (const s of action.mcpServers) authRequired.push({ name: s.name, url: s.authUrl });
      continue;
    }
    const kind = action.type === 'tool.approval_required' ? 'approval' : 'question';
    for (const ref of action.toolCalls) {
      const msg = events.get(ref.sourceEventId);
      if (msg?.type !== 'model.message') continue;
      const call = msg.toolCalls?.find((tc) => tc.id === ref.id);
      if (!call) continue;
      const p: PendingAction = {
        kind,
        threadId: action.threadId,
        toolCallId: ref.id,
        toolName: call.toolInfo?.name ?? call.function?.name ?? 'a tool',
        args: call.function?.arguments ?? '',
      };
      if (kind === 'question' && call.toolInfo?.type === 'truefoundry-system' && call.toolInfo.name === 'ask_user_question') {
        try {
          const a = JSON.parse(p.args) as { question?: unknown; options?: unknown[] };
          if (typeof a.question === 'string') p.question = a.question;
          if (Array.isArray(a.options)) p.options = a.options.map(String);
        } catch {
          /* free-form question; the tool name still tells the story */
        }
      }
      pending.push(p);
    }
  }

  // The terminal output is authoritative when present (it is the merged
  // final message); accumulated deltas cover the paused-turn case.
  const finalText = contentToText(done.output?.content).trim() || mainText;
  const result: TurnResult = { text: finalText, pending, authRequired };
  if (done.metrics) result.metrics = done.metrics;
  return result;
}

/** Convenience for plain string prompts (chatter, scribe). */
export function userMessage(content: string): TrueForgeApi.TurnInputItem[] {
  return [{ type: 'user.message', content }];
}
