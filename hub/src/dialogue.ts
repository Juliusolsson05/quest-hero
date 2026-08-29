/**
 * Dialogue broker: the player↔NPC talk path. Builds the [WORLD NOW] digest,
 * streams the reply over the WS as bubble frames, parses the emotion accent,
 * and serves canned fallback lines so the demo never hangs. All harness I/O
 * goes through trueforge.ts; headline quests are scribe.ts.
 *
 * Every character is a NAMED TrueForge agent (registered into the Agent
 * Library at boot — registerAgents) with one long-lived session as its
 * memory, and the harness's pauses are game mechanics:
 *  - ask_user_question  → the NPC asks the player in a bubble; the player's
 *    next line resumes the turn as user.tool_response.
 *  - tool approval      → the NPC asks "shall I?"; a yes-ish reply resumes
 *    as user.tool_approval allow, anything else denies with the reason.
 *  - mcp.auth_required  → surfaced as a toast + log with the authorize URL.
 */
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { Emotion, Npc } from '../../shared/protocol';
import { NPC_SEEDS, npcSeed, type NpcSeed } from './npcs';
import { SCRIBE_DEF } from './scribe';
import { engagePlayer } from './sim';
import {
  addEvent,
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
import {
  type AgentDef,
  ensureAgent,
  forgetSession,
  HarnessUnavailable,
  type PendingAction,
  sessionFor,
  streamTurn,
  userMessage,
} from './trueforge';
import { dist2d, nextId, pick, warnOnce } from './util';

/** No bytes at all from the harness for this long → the stream is dead. Wide
 *  because a server-side tool run (tavily search, scrape) is silent on the
 *  wire until its tool.response lands. */
const STALL_MS = 45_000;
/** Hard ceiling per player turn, activity or not — an agent that is still
 *  happily searching two minutes in has lost the player anyway. */
const TURN_CAP_MS = 120_000;

// ── the cast as named agents ────────────────────────────────────────────────

const npcAgentDef = (seed: NpcSeed): AgentDef => ({
  registryName: `ashford-${seed.id}`,
  persona: seed.persona,
  model: seed.model,
  webAccess: seed.webAccess,
  connectors: seed.connectors,
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
  const cap = setTimeout(() => ctrl.abort(), TURN_CAP_MS);
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
        onActivity: bump, // any bytes off the wire reset the stall watchdog
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

    const p = parseEmotion(result.text || acc);
    const final = p.text.trim();
    if (!final) throw new HarnessUnavailable('empty reply');
    finishTurn(npc, convId, final, p.emotion);
  } catch (e) {
    // A stream that dies mid-answer still said something — a truncated real
    // reply beats a canned line that ignores the question.
    const p = parseEmotion(acc);
    if (p.text.trim()) {
      finishTurn(npc, convId, p.text.trim(), p.emotion);
      return;
    }
    const why = e instanceof Error ? e.message : String(e);
    // A session TrueForge no longer knows (wiped DB, expired) gets recreated
    // on the next line instead of failing forever.
    if (/404|not.?found|no such session/i.test(why)) forgetSession(npc.id);
    warnOnce('trueforge-down', `[dialogue] TrueForge fallback path (${why}) — canned lines until it recovers`);
    finishTurn(npc, convId, pick(seed.fallbacks), 'think');
  } finally {
    clearTimeout(watchdog);
    clearTimeout(cap);
  }
}

function finishTurn(npc: Npc, convId: string, text: string, emotion: Emotion): void {
  conversations.set(convId, { done: true, text });
  npcCommitSaid(npc.id, convId, text, emotion);
  engagePlayer(npc.id); // hold still while the player reads the reply
}
