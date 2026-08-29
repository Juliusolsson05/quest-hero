/**
 * Dialogue broker: the player↔NPC talk path. Builds the [WORLD NOW] digest,
 * streams the reply over the WS as bubble frames, parses the emotion accent,
 * and serves canned fallback lines so the demo never hangs. All harness I/O
 * goes through trueforge.ts; headline quests are scribe.ts.
 */
import type { Emotion, Npc } from '../../shared/protocol';
import { npcSeed, type NpcSeed } from './npcs';
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
import { HarnessUnavailable, sessionFor, streamTurn } from './trueforge';
import { dist2d, nextId, pick, warnOnce } from './util';

const STALL_MS = 10_000;

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
}
