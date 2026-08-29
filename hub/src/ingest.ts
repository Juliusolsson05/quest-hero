/**
 * Real-data ingestors (SPEC §5) — all fail-soft: on fetch error keep the last
 * value and console.warn once per source. The village must keep living with
 * no network at all.
 *
 *   Open-Meteo (10 min)  → world weather + weather.changed event
 *   Real SF clock (60 s) → time.phase + time frame
 *   HN top stories (5 m) → Quest Scribe headline quests (≤1 active at a time)
 *   GitHub commits (90 s, ETag) → delivery crate + commit.landed + Wren bubble
 */
import type { TimePhase, TimeState, WeatherKind } from '../../shared/protocol';
import { CONFIG } from './config';
import { poi, randomWalkableNear } from '../../shared/island';
import { scribeQuest } from './scribe';
import {
  addEvent,
  getWeather,
  listQuests,
  npcAmbientSay,
  setTime,
  setWeather,
  spawnObject,
} from './state';
import { clamp, round2, warnOnce } from './util';

// ── weather ─────────────────────────────────────────────────────────────────

const WEATHER_WORD: Record<WeatherKind, string> = {
  clear: 'clear',
  clouds: 'cloudy',
  rain: 'rainy',
  fog: 'foggy',
  snow: 'snowy',
  storm: 'stormy',
};

const WEATHER_EVENT: Record<WeatherKind, string> = {
  clear: 'The skies cleared over Ashford',
  clouds: 'Clouds rolled in over Ashford',
  rain: 'It started raining in Ashford',
  fog: 'Fog crept into Ashford',
  snow: 'Snow began falling on Ashford',
  storm: 'A storm broke over Ashford',
};

function wmoToKind(code: number): WeatherKind {
  if (code <= 1) return 'clear';
  if (code <= 3) return 'clouds';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'clouds';
}

let lastReal: { kind: WeatherKind; tempC: number } = { kind: 'clear', tempC: 15 };
let weatherOverridden = false;
let resumeTimer: NodeJS.Timeout | null = null;

function applyRealWeather(): void {
  const cur = getWeather();
  const kindChanged = cur.kind !== lastReal.kind;
  if (!kindChanged && cur.real && cur.tempC === lastReal.tempC) return;
  setWeather(
    {
      kind: lastReal.kind,
      tempC: lastReal.tempC,
      real: true,
      summary: `${lastReal.tempC}°C and ${WEATHER_WORD[lastReal.kind]} in San Francisco right now`,
    },
    kindChanged
      ? { event: `${WEATHER_EVENT[lastReal.kind]} — ${lastReal.tempC}°C in San Francisco right now`, actor: 'world' }
      : {},
  );
}

async function pollWeather(): Promise<void> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.weatherLat}` +
      `&longitude=${CONFIG.weatherLon}&current_weather=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const body = (await res.json()) as { current_weather?: { temperature?: number; weathercode?: number } };
    const cw = body?.current_weather;
    if (!cw || typeof cw.temperature !== 'number') throw new Error('no current_weather in response');
    lastReal = { kind: wmoToKind(cw.weathercode ?? 0), tempC: Math.round(cw.temperature) };
    if (!weatherOverridden) applyRealWeather();
  } catch (e) {
    warnOnce('weather', `[ingest] open-meteo unreachable (${e instanceof Error ? e.message : e}) — keeping last weather`);
  }
}

/** POST /api/weather {kind} — visuals change in seconds; auto-resumes. */
export function overrideWeather(kind: WeatherKind, minutes = 30): void {
  weatherOverridden = true;
  if (resumeTimer) clearTimeout(resumeTimer);
  const tempC = getWeather().tempC;
  setWeather(
    { kind, tempC, real: false, summary: `${tempC}°C and ${WEATHER_WORD[kind]} in Ashford (weather override)` },
    { event: `${WEATHER_EVENT[kind]} — an unseen hand stirred the sky`, actor: 'mcp' },
  );
  resumeTimer = setTimeout(resumeAutoWeather, clamp(minutes, 1, 24 * 60) * 60_000);
}

/** POST /api/weather {kind:'auto'} — back to real SF weather. */
export function resumeAutoWeather(): void {
  weatherOverridden = false;
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  applyRealWeather();
}

// ── time ────────────────────────────────────────────────────────────────────

const PHASE_HOUR: Record<TimePhase, number> = { dawn: 6.5, day: 12, dusk: 19, night: 23 };

export function phaseOfHour(h: number): TimePhase {
  if (h >= 6 && h < 8) return 'dawn';
  if (h >= 8 && h < 18) return 'day';
  if (h >= 18 && h < 20.5) return 'dusk';
  return 'night';
}

let timeOverridden = false;

function realHourLA(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

function pollTime(): void {
  if (timeOverridden) return;
  const hour = round2(realHourLA());
  setTime({ phase: phaseOfHour(hour), hour, real: true });
}

/** POST /api/time {phase}|{hour} — demo night mode etc. */
export function overrideTime(input: { phase?: TimePhase; hour?: number }): TimeState {
  timeOverridden = true;
  const hour = input.phase !== undefined ? PHASE_HOUR[input.phase] : clamp(input.hour ?? 12, 0, 24) % 24;
  return setTime({ phase: phaseOfHour(hour), hour: round2(hour), real: false });
}

/** POST /api/time {mode:'real'} — resume the real SF clock. */
export function resumeRealTime(): TimeState {
  timeOverridden = false;
  const hour = round2(realHourLA());
  return setTime({ phase: phaseOfHour(hour), hour, real: true });
}

// ── Hacker News → Quest Scribe ──────────────────────────────────────────────

let lastTopStory: number | null = null;

function hasLiveHeadlineQuest(): boolean {
  return listQuests().some((q) => q.source.type === 'headline' && q.state !== 'done');
}

async function pollHN(): Promise<void> {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const ids = (await res.json()) as number[];
    const top = Array.isArray(ids) ? ids[0] : undefined;
    if (typeof top !== 'number' || top === lastTopStory) return;
    lastTopStory = top;
    if (hasLiveHeadlineQuest()) return; // ≤1 active rumor quest at a time
    const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${top}.json`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!itemRes.ok) throw new Error(`item http ${itemRes.status}`);
    const item = (await itemRes.json()) as { title?: string; url?: string };
    if (!item?.title) return;
    await scribeQuest(item.title, item.url ?? `https://news.ycombinator.com/item?id=${top}`);
  } catch (e) {
    warnOnce('hn', `[ingest] hacker news unreachable (${e instanceof Error ? e.message : e}) — no new rumor quests`);
  }
}

// ── GitHub commits → delivery crates ────────────────────────────────────────

let etag: string | null = null;
const seenShas = new Set<string>();
let firstCommitBatch = true;

interface GhCommit {
  sha?: string;
  author?: { login?: string };
  commit?: { message?: string; author?: { name?: string } };
}

function announceCommit(c: GhCommit): void {
  const sha = c.sha!;
  const sha7 = sha.slice(0, 7);
  const author = c.commit?.author?.name ?? c.author?.login ?? 'a mysterious stranger';
  const message = (c.commit?.message ?? '').split('\n')[0] || 'something new';
  const plaza = poi('plaza')!.pos;
  spawnObject(
    'crate',
    randomWalkableNear(plaza.x, plaza.z, 3),
    `commit:${sha7}`,
    undefined,
    `A delivery crate thudded down near the plaza`,
  );
  addEvent('commit.landed', `A delivery crate arrived — ${author} pushed "${message}"`, `commit:${sha7}`, {
    sha,
    author,
    message,
  });
  npcAmbientSay('wren', `A crate from afar!! ${author} sent word: "${message.slice(0, 48)}" ✨`, 'happy');
}

async function pollGitHub(): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.githubRepo}/commits?per_page=5`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'quest-hero-hub',
        // Private repo (and 5k req/h instead of 60): token comes from
        // hub/.env, e.g. `gh auth token`. Works unauthenticated too.
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        ...(etag ? { 'if-none-match': etag } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(`http ${res.status}`);
    etag = res.headers.get('etag');
    const commits = (await res.json()) as GhCommit[];
    if (!Array.isArray(commits)) return;
    const fresh = commits.filter((c) => c.sha && !seenShas.has(c.sha));
    for (const c of fresh) seenShas.add(c.sha!);
    if (firstCommitBatch) {
      firstCommitBatch = false; // only announce commits that land after boot
      return;
    }
    for (const c of fresh.reverse()) announceCommit(c); // oldest first
  } catch (e) {
    warnOnce('github', `[ingest] github unreachable (${e instanceof Error ? e.message : e}) — no crate deliveries`);
  }
}

// ── boot ────────────────────────────────────────────────────────────────────

export function startIngest(): void {
  pollTime(); // synchronous — the world has the right phase before first welcome
  void pollWeather();
  void pollHN();
  void pollGitHub();
  setInterval(pollTime, 60_000);
  setInterval(() => void pollWeather(), 10 * 60_000);
  setInterval(() => void pollHN(), 5 * 60_000);
  setInterval(() => void pollGitHub(), 90_000);
}
