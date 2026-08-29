/**
 * NPC↔NPC chatter: villagers strike up conversations with each other about
 * what actually happened THIS WEEK in San Francisco tech — grounded by a
 * Reporter agent that searches the live web (Tavily MCP, plus the sf-guide
 * city-data MCP when configured), scripted by a Playwright agent in each
 * character's own voice, and performed in-world as alternating bubbles while
 * the sim walks the pair together and holds them face to face.
 *
 * Every line lands in the event log via npcCommitSaid, so bystander NPCs can
 * gossip about a conversation they overheard — and the player can walk up and
 * join in with the normal talk flow at any moment.
 */
import type { Emotion } from '../../shared/protocol';
import { resolveModel, sessionFor, streamTurn } from './trueforge';
import { holdFacing, releaseFromChat, summonForChat } from './sim';
import {
  EMOTIONS,
  addEvent,
  getNpc,
  getTime,
  getWeather,
  listNpcs,
  listQuests,
  npcCommitSaid,
  recentEventSummaries,
} from './state';
import { dist2d, pick, warnOnce } from './util';

const EVERY_MS = Number(process.env.CHATTER_EVERY_S ?? 300) * 1000;
const NEWS_TTL_MS = 20 * 60 * 1000;
/** The imported crowd — a chat should usually include one of them. */
const TECH_IDS = ['blake', 'kayden', 'tanner', 'sloane', 'chad', 'marcus'];

interface NewsItem { headline: string; detail: string; source?: string }
interface ScriptLine { who: string; text: string; emotion: Emotion }

let news: { at: number; items: NewsItem[] } | null = null;
let running: { a: string; b: string; startedAt: number } | null = null;
let lastPair = '';
let lastTopic = '';
let nextAt = Date.now() + 60_000;

// ── plumbing ────────────────────────────────────────────────────────────────

async function agentText(key: string, persona: string, model: string,
                         connectors: string[], prompt: string, timeoutMs = 75_000): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  const sid = await sessionFor(key, { persona, model, connectors }, signal);
  let out = '';
  await streamTurn(sid, prompt, { onDelta: (c) => { out += c; } }, signal);
  return out;
}

function extractJson<T>(raw: string): T | null {
  const start = raw.indexOf(raw.trimStart().startsWith('[') ? '[' : '{');
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)) as T; } catch { return null; }
}

// ── the reporter: this week's real SF/tech happenings ───────────────────────

const REPORTER_PERSONA =
  'You are a news scout for a video game. You research with your tools and reply ' +
  'ONLY with the exact JSON asked for — no prose, no code fences.';

async function fetchNews(): Promise<NewsItem[]> {
  if (news && Date.now() - news.at < NEWS_TTL_MS) return news.items;
  const today = new Date().toISOString().slice(0, 10);
  const prompt =
    `Today is ${today}. Use your web search tool (search the web — do not answer from memory) to find ` +
    `4-5 concrete things from THIS WEEK that San Francisco tech people are talking about: product launches, ` +
    `AI/dev-tool news, a hackathon or demo that went viral, funding, and at least one lighter SF-life item ` +
    `(fog, food, Waymo sightings, a great event). Be quick: at most 2 broad searches, then write. If a ` +
    `city-data tool is available you may add one live SF fact (air quality, quakes, tides). Reply with ONLY this JSON:\n` +
    `[{"headline":"...", "detail":"one concrete sentence with a name or number", "source":"site"}]`;
  try {
    const model = await resolveModel('openai/gpt-5-5');
    let raw = await agentText('chatter-reporter', REPORTER_PERSONA, model, ['tavily', 'sf-guide'], prompt, 240_000);
    let items = extractJson<NewsItem[]>(raw);
    if (!items?.length) {
      raw = await agentText('chatter-reporter', REPORTER_PERSONA, model, ['tavily', 'sf-guide'],
        'That was not parseable. Reply again with ONLY the JSON array, nothing else.', 120_000);
      items = extractJson<NewsItem[]>(raw);
    }
    const clean = (items ?? [])
      .filter((i) => i?.headline && i?.detail)
      .map((i) => ({ headline: String(i.headline).slice(0, 120), detail: String(i.detail).slice(0, 220), source: i.source && String(i.source).slice(0, 40) }))
      .slice(0, 6);
    if (clean.length) {
      news = { at: Date.now(), items: clean };
      addEvent('mcp.custom', `Word from the far roads: "${clean[0].headline}"`, 'chatter', { items: clean.length });
      return clean;
    }
  } catch (e) {
    warnOnce('chatter-news', `[chatter] news fetch failed (${e instanceof Error ? e.message : e}) — using fallback topics`);
  }
  // Fallback: whatever headline quests the hub already scribed, plus evergreens.
  const questNews = listQuests()
    .filter((q) => q.source.type === 'headline')
    .map((q) => ({ headline: q.title, detail: q.pitch }));
  return [
    ...questNews,
    { headline: 'Karl the Fog is trending again', detail: 'The fog rolled in right over the demo hour, as tradition demands' },
    { headline: 'Hackathon season in SoMa', detail: 'Teams shipping agent-powered games in a single day' },
    { headline: 'Waymos keep getting photographed', detail: 'A robotaxi queued politely behind a cable car and the internet loved it' },
  ];
}

// ── the playwright: script one conversation ─────────────────────────────────

const PLAYWRIGHT_PERSONA =
  'You write short in-game dialogues between two villagers. You reply ONLY with the exact ' +
  'JSON asked for — no prose, no code fences.';

async function generateScript(aId: string, bId: string, items: NewsItem[]): Promise<ScriptLine[] | null> {
  const a = getNpc(aId);
  const b = getNpc(bId);
  if (!a || !b) return null;
  const t = getTime();
  const w = getWeather();
  const chosen = items.slice(0, 3);
  const prompt =
    `Write a short overheard conversation for a cozy kawaii voxel village whose residents are secretly ` +
    `plugged into the San Francisco tech scene.\n\n` +
    `SPEAKER 1 — id "${a.id}": ${a.name}, ${a.role}. Voice: ${a.persona.slice(0, 260)}\n` +
    `SPEAKER 2 — id "${b.id}": ${b.name}, ${b.role}. Voice: ${b.persona.slice(0, 260)}\n\n` +
    `Right now in the village: ${t.phase}, ${w.summary}. Recently: ${recentEventSummaries(4).join(' · ') || 'a quiet day'}.\n` +
    `THIS WEEK'S REAL NEWS (use at least two, concretely — names and numbers, not vaguely):\n` +
    chosen.map((n, i) => `${i + 1}. ${n.headline} — ${n.detail}`).join('\n') + '\n\n' +
    `Rules: 6 to 8 lines, strictly alternating, "${a.id}" speaks first and every line ANSWERS the one before ` +
    `(react, disagree, one-up, laugh — never two monologues). Tone: devs doing cool stuff and enjoying SF, ` +
    `warm and funny — land at least two actual jokes (banter, not puns about being an NPC). Each line ≤ 120 chars, ` +
    `kawaii-cheerful, an emoji like ✨☔❗ now and then. End on a fun button line.\n` +
    `Reply with ONLY this JSON: {"topic":"3-5 words","lines":[{"who":"${a.id}","text":"...","emotion":"happy|sad|shock|think|neutral"}]}`;
  try {
    const model = await resolveModel('openai/gpt-5-4-mini');
    const key = `chatter-play-${aId}-${bId}`;
    let raw = await agentText(key, PLAYWRIGHT_PERSONA, model, [], prompt);
    let parsed = extractJson<{ topic?: string; lines?: ScriptLine[] }>(raw);
    if (!parsed?.lines?.length) {
      raw = await agentText(key, PLAYWRIGHT_PERSONA, model, [],
        'Not parseable. Reply again with ONLY the JSON object, nothing else.');
      parsed = extractJson<{ topic?: string; lines?: ScriptLine[] }>(raw);
    }
    if (!parsed?.lines?.length) return null;
    lastTopic = String(parsed.topic ?? '').slice(0, 60);
    const ids = [aId, bId];
    return parsed.lines
      .filter((l) => l?.text)
      .slice(0, 8)
      .map((l, i) => {
        let text = String(l.text);
        if (text.length > 150) {
          // Clamp on a word boundary — a bubble cut mid-word reads as a bug.
          text = text.slice(0, 150);
          const sp = text.lastIndexOf(' ');
          text = (sp > 100 ? text.slice(0, sp) : text) + '…';
        }
        return {
          who: ids.includes(l.who) ? l.who : ids[i % 2], // force alternation on bad ids
          text,
          emotion: EMOTIONS.includes(l.emotion) ? l.emotion : 'happy',
        };
      });
  } catch (e) {
    warnOnce('chatter-play', `[chatter] script generation failed (${e instanceof Error ? e.message : e})`);
    return null;
  }
}

// ── the performance ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function performConversation(aId: string, bId: string): Promise<boolean> {
  const items = await fetchNews();
  const script = await generateScript(aId, bId, items);
  if (!script || script.length < 2) return false;

  const a = getNpc(aId)!;
  const b = getNpc(bId)!;
  summonForChat(aId, bId);
  const deadline = Date.now() + 22_000;
  while (Date.now() < deadline) {
    if (dist2d(a.pos.x, a.pos.z, b.pos.x, b.pos.z) < 2.6) break;
    await sleep(500);
  }

  const lineMs = (text: string) => Math.min(1_500 + text.length * 55, 8_000);
  const totalMs = script.reduce((s, l) => s + lineMs(l.text), 0) + 6_000;
  holdFacing(aId, bId, totalMs);
  addEvent('npc.action',
    `${a.name} and ${b.name} got chatting${lastTopic ? ` about ${lastTopic}` : ''}`,
    aId, { with: bId, topic: lastTopic });

  const convId = `chat-${Date.now().toString(36)}`;
  for (const line of script) {
    npcCommitSaid(line.who, convId, line.text, line.emotion);
    await sleep(lineMs(line.text));
  }
  releaseFromChat([aId, bId]);
  return true;
}

// ── pairing + scheduling ────────────────────────────────────────────────────

function pickPair(): [string, string] | null {
  const npcs = listNpcs();
  if (npcs.length < 2) return null;
  const techHere = npcs.filter((n) => TECH_IDS.includes(n.id));
  const first = techHere.length ? pick(techHere) : pick(npcs);
  // Nearest few make natural partners; a dash of randomness keeps pairs fresh.
  const partners = npcs
    .filter((n) => n.id !== first.id)
    .sort((x, y) => dist2d(x.pos.x, x.pos.z, first.pos.x, first.pos.z) -
                    dist2d(y.pos.x, y.pos.z, first.pos.x, first.pos.z))
    .slice(0, 4);
  let second = pick(partners);
  if (`${first.id}+${second.id}` === lastPair && partners.length > 1) {
    second = partners.find((p) => p.id !== second.id) ?? second;
  }
  lastPair = `${first.id}+${second.id}`;
  return [first.id, second.id];
}

export function chatterStatus() {
  return {
    running,
    lastTopic,
    nextInS: running ? null : Math.max(0, Math.round((nextAt - Date.now()) / 1000)),
    newsAgeS: news ? Math.round((Date.now() - news.at) / 1000) : null,
    newsItems: news?.items.map((n) => n.headline) ?? [],
  };
}

/** Kick one off right now (REST/MCP hook). Returns null if busy or impossible. */
export function forceChatter(aId?: string, bId?: string): { a: string; b: string } | null {
  if (running) return null;
  let pair: [string, string] | null;
  if (aId && bId && getNpc(aId) && getNpc(bId) && aId !== bId) pair = [aId, bId];
  else pair = pickPair();
  if (!pair) return null;
  void runOne(pair);
  return { a: pair[0], b: pair[1] };
}

async function runOne(pair: [string, string]): Promise<void> {
  running = { a: pair[0], b: pair[1], startedAt: Date.now() };
  try {
    await performConversation(pair[0], pair[1]);
  } catch (e) {
    warnOnce('chatter-run', `[chatter] conversation failed (${e instanceof Error ? e.message : e})`);
  } finally {
    running = null;
    nextAt = Date.now() + EVERY_MS * (0.8 + Math.random() * 0.4);
  }
}

export function startChatter(): void {
  if (process.env.CHATTER_DISABLED === '1') return;
  nextAt = Date.now() + 60_000; // let the village boot and the model warm up
  setInterval(() => {
    if (running || Date.now() < nextAt) return;
    const pair = pickPair();
    if (pair) void runOne(pair);
  }, 5_000);
  // Warm the news cache early so the first conversation doesn't wait on search.
  setTimeout(() => { void fetchNews(); }, 15_000);
}
