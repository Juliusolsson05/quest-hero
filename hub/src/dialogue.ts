/**
 * Dialogue broker: every character is a NAMED TrueForge agent (registered in
 * the Agent Library at boot — see registerAgents) with one long-lived session
 * as its memory. A player line becomes a turn with a [WORLD NOW] digest;
 * deltas stream back over the WS as bubble frames; canned fallback lines keep
 * the demo alive when the harness is unreachable.
 *
 * The harness's pauses are game mechanics, exactly as the README promises:
 *  - ask_user_question  → the NPC asks the player in a bubble; the player's
 *    next line resumes the turn as user.tool_response.
 *  - tool approval      → the NPC asks "shall I?"; a yes-ish reply resumes
 *    as user.tool_approval allow, anything else denies with the reason.
 *  - mcp.auth_required  → surfaced as a toast + log with the authorize URL.
 *
 * All TrueForge mechanics live in harness.ts; this file is the game side.
 */
import type { Emotion, Npc, Quest, QuestStep } from '../../shared/protocol';
import {
  type AgentDef,
  ensureAgent,
  forgetSession,
  HarnessUnavailable,
  type PendingAction,
  sessionFor,
  streamTurn,
  userMessage,
} from './harness';
import { POI_IDS } from './island';
import { NPC_IDS, NPC_SEEDS, npcSeed, type NpcSeed } from './npcs';
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
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';

const STALL_MS = 12_000;

// ── the cast as named agents ────────────────────────────────────────────────

const npcAgentDef = (seed: NpcSeed): AgentDef => ({
  registryName: `ashford-${seed.id}`,
  persona: seed.persona,
  model: seed.model,
  webAccess: seed.webAccess,
});

/**
 * Boot hook: save every character (and the Quest Scribe) into the TrueForge
 * Agent Library, so the whole cast shows up as first-class agents in the
 * harness UI. Fail-soft — a down harness just means lazy registration later.
 */
export async function registerAgents(): Promise<void> {
  let ok = 0;
  for (const def of [...NPC_SEEDS.map(npcAgentDef), SCRIBE_DEF]) {
    try {
      await ensureAgent(def);
      ok++;
    } catch (e) {
      warnOnce('register-agents', `[dialogue] agent registration paused (${e instanceof Error ? e.message : e}) — will retry lazily`);
      return;
    }
  }
  console.log(`[dialogue] ${ok} agents registered in the TrueForge Agent Library (ashford-*)`);
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

/** Turns that ended paused, waiting on the player's next line to this NPC. */
const pendingPauses = new Map<string, PendingAction[]>();

const YES_RE = /^\s*(y|yes|aye|yeah|yep|ya|sure|ok|okay|do it|go ahead|please do|fine|alright|granted|allow)\b/i;

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

/** The player's line answers a paused turn: approvals get a yes/no decision,
 *  questions get the line verbatim. One line answers every pending call. */
function resumeInput(paused: PendingAction[], text: string): TrueForgeApi.TurnInputItem[] {
  const approve = YES_RE.test(text);
  return paused.map((p) =>
    p.kind === 'approval'
      ? {
          type: 'user.tool_approval',
          threadId: p.threadId,
          toolCallId: p.toolCallId,
          approval: approve ? { status: 'allow' } : { status: 'deny', reason: text.slice(0, 200) },
        }
      : { type: 'user.tool_response', threadId: p.threadId, toolCallId: p.toolCallId, content: text },
  );
}

/** The NPC voices a pause: a clarifying question as itself, or an approval
 *  gate as the in-world "shall I?" the README calls a game mechanic. */
function pauseLine(p: PendingAction): string {
  if (p.kind === 'question') {
    const q = p.question ?? 'I need to ask you something first';
    return p.options?.length ? `${q} (${p.options.join(' / ')})` : q;
  }
  return `I'd need to use ${p.toolName} for that — shall I? (yes / no)`;
}

async function runTurn(npc: Npc, seed: NpcSeed, convId: string, text: string, from?: string): Promise<void> {
  broadcast({ t: 'bubble', who: npc.id, convId, text: '…', emotion: 'think', mode: 'thinking' });

  // A paused turn must resume with approval/response items (never mixed with
  // a user.message); otherwise the digest-first pattern applies as usual.
  const paused = pendingPauses.get(npc.id);
  let input: TrueForgeApi.TurnInputItem[];
  if (paused?.length) {
    pendingPauses.delete(npc.id);
    input = resumeInput(paused, text);
  } else {
    input = userMessage(buildWorldNow(npc, from, text));
  }
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
    const sid = await sessionFor(npc.id, npcAgentDef(seed), ctrl.signal);
    const result = await streamTurn(
      sid,
      input,
      {
        onEvent: bump, // any stream activity resets the stall watchdog
        onDelta: (chunk) => {
          acc += chunk;
          if (/^\s*\[[a-z]*$/i.test(acc)) return; // partial leading emotion tag — hold
          const p = parseEmotion(acc);
          const now = Date.now();
          if (now - lastEmit >= 100) {
            lastEmit = now;
            broadcast({ t: 'bubble', who: npc.id, convId, text: p.text, emotion: p.emotion, mode: 'delta' });
          }
        },
        onTool: (label) => {
          broadcast({ t: 'bubble', who: npc.id, convId, text: label, emotion: 'think', mode: 'tool' });
        },
        onThread: (title) => {
          broadcast({ t: 'bubble', who: npc.id, convId, text: `sending a helper: ${title}`, emotion: 'think', mode: 'tool' });
        },
      },
      ctrl.signal,
    );
    clearTimeout(watchdog);

    if (result.metrics?.totalTokens != null) {
      console.log(
        `[dialogue] ${npc.id} turn: ${result.metrics.totalTokens} tokens` +
          (result.metrics.totalCostInUsd != null ? ` ($${result.metrics.totalCostInUsd.toFixed(4)})` : ''),
      );
    }

    // MCP OAuth needed: nothing the player can answer in-world — surface it.
    if (result.authRequired.length) {
      for (const a of result.authRequired) {
        console.warn(`[dialogue] MCP server "${a.name}" needs authorization: ${a.url}`);
      }
      addEvent('mcp.custom', `${npc.name}'s far-seeing tools need authorization (see hub logs)`, npc.id);
      finishTurn(npc, convId, 'My far-seeing tools need a permission slip from the harness — try me again soon ✨', 'think');
      return;
    }

    // The turn paused on the player: the gate IS the dialogue.
    if (result.pending.length) {
      pendingPauses.set(npc.id, result.pending);
      const lead = parseEmotion(result.text).text.trim();
      const ask = pauseLine(result.pending[0]);
      finishTurn(npc, convId, lead ? `${lead} ${ask}` : ask, 'think');
      return;
    }

    const p = parseEmotion(result.text);
    const final = p.text.trim();
    if (!final) throw new HarnessUnavailable('empty reply');
    finishTurn(npc, convId, final, p.emotion);
  } catch (e) {
    clearTimeout(watchdog);
    const why = e instanceof Error ? e.message : String(e);
    // A session TrueForge no longer knows (wiped DB, expired) gets recreated
    // on the next line instead of failing forever.
    if (/404|not.?found|no such session/i.test(why)) forgetSession(npc.id);
    warnOnce('forge-down', `[dialogue] TrueForge fallback path (${why}) — canned lines until it recovers`);
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

// ── Quest Scribe (a JSON-mode agent: response_format json_object) ───────────

const SCRIBE_DEF: AgentDef = {
  registryName: 'ashford-quest-scribe',
  model: 'openai/gpt-5-5',
  json: true,
  subagents: false, // one headline in, one quest out — no fan-out needed
  persona:
    'You are the Quest Scribe of Ashford, a cozy kawaii village game. Given one real news ' +
    'headline, turn it into one tiny village quest. Reply with STRICT JSON only — no prose, ' +
    'no code fences. Schema: {"title": string (short, village-flavored), "pitch": string ' +
    '(kawaii, at most 140 characters, a village-flavored riff on the headline), "steps": ' +
    '[1 or 2 steps, each {"kind":"talk","target":"wren","text":string} or ' +
    '{"kind":"goto","target":"<poi>","text":string}], "reward":{"coins": number between 5 and 20}}. ' +
    'Allowed talk targets: bran, wren, suki. Allowed goto targets: plaza, forge, market, farm, ' +
    'docks, hill, board, mailbox, pen, flowerpatch. JSON only.',
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
  const ctrl = new AbortController();
  const wd = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const result = await streamTurn(sid, userMessage(content), { onDelta: () => {} }, ctrl.signal);
    return parseScribe(result.text, url);
  } finally {
    clearTimeout(wd);
  }
}

/**
 * Headline → notice-board quest. Garbage JSON twice → skip; TrueForge
 * unreachable → template quest, so the feature demos without the harness.
 */
export async function scribeQuest(headline: string, url: string): Promise<Quest | null> {
  try {
    const sid = await sessionFor('quest-scribe', SCRIBE_DEF, AbortSignal.timeout(10_000));
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
