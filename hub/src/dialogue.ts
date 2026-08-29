/**
 * Dialogue broker: one TrueForge session per NPC (created lazily, kept for the
 * run — that persistence IS the character's memory), a [WORLD NOW] digest
 * injected before every player line, deltas streamed back over the WS as
 * bubble frames, and canned fallback lines so the demo never hangs.
 *
 * TrueForge contract (verified against the live 0.2.0-rc.0 server; the shapes
 * in game/src/harness.ts mirror it):
 *   POST /api/v1/sessions        {agent:{spec:{model:{name},instructions,mcp_servers?}}}
 *                                → session id at body.data.id (no metadata key!)
 *   GET  /api/v1/models          → {data:[{name}]} configured chat models
 *   GET  /api/v1/mcp-servers     → {data:[{name,auth_status:{status}}]}
 *   POST /api/v1/sessions/:id/turns?stream=true
 *                                → SSE: model.message.delta (.content and/or
 *                                  .tool_calls fragments), mcp.initialize,
 *                                  tool.response, turn.done
 */
import type { Emotion, Npc, Quest, QuestStep } from '../../shared/protocol';
import { CONFIG } from './config';
import { POI_IDS } from './island';
import { NPC_IDS, npcSeed, type NpcSeed } from './npcs';
import { engagePlayer } from './sim';
import {
  addEvent,
  addQuest,
  broadcast,
  getNpc,
  getPlayer,
  getTime,
  getWeather,
  listAnimals,
  listNpcs,
  listObjects,
  listQuests,
  npcCommitSaid,
  questsAutoTalk,
  recentEventSummaries,
} from './state';
import { clamp, dist2d, nextId, pick, warnOnce } from './util';

const BASE = CONFIG.trueforgeBase;
const STALL_MS = 10_000;

class HarnessUnavailable extends Error {}

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

/** Connectors a webAccess NPC gets, matched against what the harness actually
 *  has configured AND authenticated, in preference order: the search providers
 *  first, then sf-guide (our own live SF city-data MCP — weather/fog, quakes,
 *  tides, bike share, DataSF datasets). Names must match the TrueForge
 *  connector names exactly; anything not configured is silently skipped, and
 *  WEB_TOOLS_RULE in npcs.ts tells the characters how to use whatever lands. */
const WEB_CONNECTORS = ['bright-data', 'tavily', 'exa', 'parallel-web', 'sf-guide'];

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

// ── emotion parsing ─────────────────────────────────────────────────────────

const TAG_RE = /^\s*\[(happy|sad|shock|think)\]\s*/i;
const EMOJI_EMOTION: [Emotion, string[]][] = [
  ['happy', ['✨', '🌸', '😊', '😄', '🎉', '☀', '♪', '💖', '🌞']],
  ['sad', ['☔', '💧', '😢', '😿', '🌧', '😞']],
  ['shock', ['❗', '⚡', '😱', '💥', '‼', '😲']],
  ['think', ['🤔', '💭', '…']],
];

/** A leading [happy]/[sad]/[shock]/[think] tag (stripped) or a leading emoji
 *  (kept) becomes the bubble's emotion accent. */
export function parseEmotion(raw: string): { text: string; emotion: Emotion } {
  const m = TAG_RE.exec(raw);
  if (m) return { text: raw.replace(TAG_RE, ''), emotion: m[1].toLowerCase() as Emotion };
  const first = [...raw.trim()][0] ?? '';
  for (const [emotion, emojis] of EMOJI_EMOTION) {
    if (emojis.includes(first)) return { text: raw, emotion };
  }
  return { text: raw, emotion: 'neutral' };
}

// ── [WORLD NOW] digest ──────────────────────────────────────────────────────

function buildWorldNow(npc: Npc, from: string | undefined, text: string): string {
  const t = getTime();
  const w = getWeather();
  const hh = String(Math.floor(t.hour) % 24).padStart(2, '0');
  const mm = String(Math.floor((t.hour % 1) * 60)).padStart(2, '0');

  const near: string[] = [];
  const close = (x: number, z: number) => dist2d(npc.pos.x, npc.pos.z, x, z) <= 8;
  for (const other of listNpcs()) {
    if (other.id !== npc.id && close(other.pos.x, other.pos.z)) near.push(`${other.name} (${other.activity})`);
  }
  const player = getPlayer();
  if (close(player.pos.x, player.pos.z)) near.push(`${player.name} the traveller`);
  for (const a of listAnimals()) if (close(a.pos.x, a.pos.z)) near.push(`a ${a.kind}`);
  for (const o of listObjects()) if (close(o.pos.x, o.pos.z)) near.push(`a ${o.kind}`);

  const questLine =
    listQuests()
      .filter((q) => q.state !== 'done')
      .map((q) => `${q.title} (${q.state})`)
      .join('; ') || 'none right now';
  const happenings = recentEventSummaries(12).map((s) => `- ${s}`).join('\n') || '- a quiet day so far';

  return (
    `[WORLD NOW]\n` +
    `time: ${t.phase}, ~${hh}:${mm}\n` +
    `weather: ${w.summary}\n` +
    `your current activity: ${npc.activity}\n` +
    `nearby: ${near.join(', ') || 'nobody close by'}\n` +
    `active quests: ${questLine}\n` +
    `recent happenings:\n${happenings}\n\n` +
    `[${from ?? 'A traveller'} says]: ${text}`
  );
}

// ── conversations ───────────────────────────────────────────────────────────

interface Conversation {
  done: boolean;
  text: string;
}

const conversations = new Map<string, Conversation>();

export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}

/**
 * POST /api/npcs/:id/talk and the WS `talk` frame both land here. Responds
 * immediately with a conversation id; the reply streams over the WS and lands
 * in the conversation map for GET /api/conversations/:id polling.
 */
export function talk(npcId: string, text: string, from?: string): string | null {
  const npc = getNpc(npcId);
  const seed = npcSeed(npcId);
  if (!npc || !seed || typeof text !== 'string' || !text.trim()) return null;

  engagePlayer(npc.id); // stop and face the player for the whole exchange

  const convId = nextId('conv');
  conversations.set(convId, { done: false, text: '' });
  if (conversations.size > 200) {
    const oldest = conversations.keys().next().value;
    if (oldest) conversations.delete(oldest);
  }
  void runTurn(npc, seed, convId, text.trim().slice(0, 500), from);
  return convId;
}

async function runTurn(npc: Npc, seed: NpcSeed, convId: string, text: string, from?: string): Promise<void> {
  broadcast({ t: 'bubble', who: npc.id, convId, text: '…', emotion: 'think', mode: 'thinking' });

  // Digest first, THEN the player.said event — the [says] line already carries
  // this turn's message, so the log entry is for later turns and other NPCs.
  const digest = buildWorldNow(npc, from, text);
  addEvent('player.said', `${from ?? 'A traveller'} said to ${npc.name}: "${text.slice(0, 80)}"`, 'player');
  questsAutoTalk(npc.id);

  let acc = '';
  let lastEmit = 0;
  const ctrl = new AbortController();
  let watchdog = setTimeout(() => ctrl.abort(), STALL_MS);
  const bump = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ctrl.abort(), STALL_MS);
  };

  try {
    const sid = await sessionFor(npc.id, seed, ctrl.signal);
    await streamTurn(
      sid,
      digest,
      {
        onDelta: (chunk) => {
          acc += chunk;
          bump();
          if (/^\s*\[[a-z]*$/i.test(acc)) return; // partial leading emotion tag — hold
          const p = parseEmotion(acc);
          const now = Date.now();
          if (now - lastEmit >= 100) {
            lastEmit = now;
            broadcast({ t: 'bubble', who: npc.id, convId, text: p.text, emotion: p.emotion, mode: 'delta' });
          }
        },
        onTool: (label) => {
          bump();
          broadcast({ t: 'bubble', who: npc.id, convId, text: label, emotion: 'think', mode: 'tool' });
        },
      },
      ctrl.signal,
    );
    clearTimeout(watchdog);
    const p = parseEmotion(acc);
    const final = p.text.trim();
    if (!final) throw new HarnessUnavailable('empty reply');
    finishTurn(npc, convId, final, p.emotion);
  } catch (e) {
    clearTimeout(watchdog);
    const why = e instanceof Error ? e.message : String(e);
    warnOnce('trueforge-down', `[dialogue] TrueForge fallback path (${why}) — canned lines until it recovers`);
    finishTurn(npc, convId, pick(seed.fallbacks), 'think');
  }
}

function finishTurn(npc: Npc, convId: string, text: string, emotion: Emotion): void {
  conversations.set(convId, { done: true, text });
  npcCommitSaid(npc.id, convId, text, emotion);
  engagePlayer(npc.id); // hold still while the player reads the reply
}

// ── quest step validation (shared with POST /api/quests) ────────────────────

export function validateSteps(input: unknown): QuestStep[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: QuestStep[] = [];
  for (const s of input as Array<Record<string, unknown>>) {
    const kind = s?.kind;
    const target = s?.target;
    const text = typeof s?.text === 'string' && s.text.trim() ? s.text.trim().slice(0, 120) : null;
    if (!text || typeof target !== 'string') return null;
    if (kind === 'talk') {
      if (!NPC_IDS.includes(target)) return null;
    } else if (kind === 'goto') {
      if (!POI_IDS.includes(target)) return null;
    } else if (kind === 'collect') {
      if (!target.trim()) return null;
    } else {
      return null;
    }
    out.push({ id: `s${out.length + 1}`, kind, target, text, done: false });
  }
  return out;
}

// ── Quest Scribe ────────────────────────────────────────────────────────────

const SCRIBE_SPEC: SessionSpec = {
  persona:
    'You are the Quest Scribe of Ashford, a cozy kawaii village game. Given one real news ' +
    'headline, turn it into one tiny village quest. Reply with STRICT JSON only — no prose, ' +
    'no code fences. Schema: {"title": string (short, village-flavored), "pitch": string ' +
    '(kawaii, at most 140 characters, a village-flavored riff on the headline), "steps": ' +
    '[1 or 2 steps, each {"kind":"talk","target":"wren","text":string} or ' +
    '{"kind":"goto","target":"<poi>","text":string}], "reward":{"coins": number between 5 and 20}}. ' +
    'Allowed talk targets: bran, wren, suki. Allowed goto targets: plaza, forge, market, farm, ' +
    'docks, hill, board, mailbox, pen, flowerpatch. JSON only.',
  model: 'openai/gpt-5-5',
};

function parseScribe(raw: string, url: string): Quest | null {
  const stripped = raw.replace(/```(?:json)?/gi, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: Record<string, any>;
  try {
    obj = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof obj?.title !== 'string' || !obj.title.trim() || typeof obj?.pitch !== 'string') return null;
  const steps = validateSteps(obj.steps);
  if (!steps || steps.length > 2) return null;
  const coins = clamp(Math.round(Number(obj?.reward?.coins) || 8), 5, 20);
  return {
    id: nextId('quest'),
    title: obj.title.trim().slice(0, 60),
    pitch: obj.pitch.trim().slice(0, 140),
    giver: 'wren',
    source: { type: 'headline', ref: url },
    steps,
    state: 'offered',
    reward: { coins },
  };
}

function templateQuest(headline: string, url: string): Quest {
  const short = headline.length > 70 ? headline.slice(0, 67) + '…' : headline;
  return {
    id: nextId('quest'),
    title: short.length > 48 ? short.slice(0, 45) + '…' : short,
    pitch: `Word from afar!! "${short}" — Wren wants to hear what the town thinks!`,
    giver: 'wren',
    source: { type: 'headline', ref: url },
    steps: [
      { id: 's1', kind: 'talk', target: 'wren', text: 'Ask Wren about the word from afar', done: false },
      { id: 's2', kind: 'goto', target: 'board', text: 'Check the notice board in the plaza', done: false },
    ],
    state: 'offered',
    reward: { coins: 8 },
  };
}

async function scribeTurn(sid: string, content: string, url: string): Promise<Quest | null> {
  let acc = '';
  const ctrl = new AbortController();
  let wd = setTimeout(() => ctrl.abort(), 12_000);
  try {
    await streamTurn(
      sid,
      content,
      {
        onDelta: (c) => {
          acc += c;
          clearTimeout(wd);
          wd = setTimeout(() => ctrl.abort(), 12_000);
        },
      },
      ctrl.signal,
    );
  } finally {
    clearTimeout(wd);
  }
  return parseScribe(acc, url);
}

/**
 * Headline → notice-board quest. Garbage JSON twice → skip; TrueForge
 * unreachable → template quest, so the feature demos without the harness.
 */
export async function scribeQuest(headline: string, url: string): Promise<Quest | null> {
  try {
    const sid = await sessionFor('quest-scribe', SCRIBE_SPEC, AbortSignal.timeout(8_000));
    let quest = await scribeTurn(sid, `Headline: "${headline}" (${url})`, url);
    quest ??= await scribeTurn(sid, 'That was not valid JSON matching the schema. Reply again with ONLY the JSON object.', url);
    if (!quest) {
      warnOnce('scribe-garbage', '[scribe] unusable JSON twice — skipping this headline');
      return null;
    }
    return addQuest(quest);
  } catch {
    warnOnce('scribe-down', '[scribe] TrueForge unreachable — creating template headline quest instead');
    return addQuest(templateQuest(headline, url));
  }
}
