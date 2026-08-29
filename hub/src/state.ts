/**
 * The one store. All mutable world data lives here (SPEC §5): mutators append
 * an event to the ring buffer AND broadcast the matching WS frame, so the
 * event log, the MCP surface and the renderer can never disagree about what
 * happened. NPC briefings are literally the tail of `events`.
 */
import type {
  Animal,
  Emotion,
  Npc,
  ObjectKind,
  PlayerState,
  Quest,
  QuestStep,
  ServerFrame,
  TimePhase,
  TimeState,
  Vec3,
  WeatherKind,
  WeatherState,
  WObject,
  World,
  WorldEvent,
} from '../../shared/protocol';
import { heightAt, isLand, poi, SPAWN } from './island';
import { NPC_SEEDS } from './npcs';
import { nextId } from './util';

// ── broadcast + event fan-out ───────────────────────────────────────────────

let broadcastFn: (frame: ServerFrame) => void = () => {};
export function setBroadcast(fn: (frame: ServerFrame) => void): void {
  broadcastFn = fn;
}
export function broadcast(frame: ServerFrame): void {
  broadcastFn(frame);
}

type EventListener = (e: WorldEvent) => void;
const eventListeners = new Set<EventListener>();
/** Subscribe to every new event (SSE feed). Returns an unsubscribe fn. */
export function onEvent(fn: EventListener): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

// ── catalogs (runtime twins of protocol.ts unions) ──────────────────────────

export const OBJECT_KINDS: ObjectKind[] = ['crate', 'barrel', 'flower', 'pumpkin', 'gift', 'torch', 'snowman'];
export const EMOTIONS: Emotion[] = ['happy', 'sad', 'shock', 'think', 'neutral'];
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'clouds', 'rain', 'fog', 'snow', 'storm'];
export const TIME_PHASES: TimePhase[] = ['dawn', 'day', 'dusk', 'night'];

// ── the world ───────────────────────────────────────────────────────────────

const npcs: Npc[] = NPC_SEEDS.map((seed, i) => {
  const home = poi(seed.home)!;
  // Fan out on a golden-angle ring so housemates never spawn stacked.
  const ang = i * 2.399963;
  const r = 1.3 + (i % 3) * 0.6;
  let x = home.pos.x + Math.sin(ang) * r;
  let z = home.pos.z + Math.cos(ang) * r;
  if (!isLand(x, z)) ({ x, z } = home.pos);
  return {
    id: seed.id,
    name: seed.name,
    role: seed.role,
    pos: { x, y: heightAt(x, z), z },
    rot: ang,
    anim: 'idle',
    activity: 'settling in for the day',
    mood: 'neutral',
    persona: seed.persona,
    bubbleTint: seed.bubbleTint,
    look: seed.look ?? 'villager',
  };
});

const penPos = poi('pen')!.pos;
const plazaPos = poi('plaza')!.pos;
const flowerPos = poi('flowerpatch')!.pos;
const animals: Animal[] = [
  { id: 'chick-1', kind: 'chicken', pos: { x: penPos.x - 0.8, y: penPos.y, z: penPos.z + 0.4 }, rot: 0, state: 'peck' },
  { id: 'chick-2', kind: 'chicken', pos: { x: penPos.x + 0.6, y: penPos.y, z: penPos.z - 0.5 }, rot: 2, state: 'peck' },
  { id: 'chick-3', kind: 'chicken', pos: { x: penPos.x + 0.2, y: penPos.y, z: penPos.z + 0.9 }, rot: 4, state: 'wander' },
  { id: 'cat-1', kind: 'cat', pos: { x: plazaPos.x + 2.2, y: plazaPos.y, z: plazaPos.z + 1.4 }, rot: 1, state: 'wander' },
  { id: 'fly-1', kind: 'butterfly', pos: { x: flowerPos.x + 1, y: flowerPos.y + 1.2, z: flowerPos.z }, rot: 0, state: 'flutter' },
  { id: 'fly-2', kind: 'butterfly', pos: { x: flowerPos.x - 1, y: flowerPos.y + 1.4, z: flowerPos.z + 1 }, rot: 2, state: 'flutter' },
  { id: 'fly-3', kind: 'butterfly', pos: { x: plazaPos.x, y: plazaPos.y + 1.3, z: plazaPos.z - 2 }, rot: 4, state: 'flutter' },
];

const objects: WObject[] = [];

/** Seed quest ported from game/src/state.ts — The Cracked Blade. */
const quests: Quest[] = [
  {
    id: 'reforge',
    title: 'The Cracked Blade',
    pitch: 'An old blade, a hot forge, and a blacksmith who never wastes words. Bring Bran what he needs ⚒️✨',
    giver: 'bran',
    source: { type: 'handcrafted' },
    steps: [
      { id: 'ask-bran', kind: 'talk', target: 'bran', text: 'Ask Bran about the cracked blade', done: false },
      { id: 'get-ingot', kind: 'collect', target: 'iron-ingot', text: 'Bring Bran an iron ingot', done: false },
      { id: 'reforged', kind: 'talk', target: 'bran', text: 'Collect the reforged blade', done: false },
    ],
    state: 'offered',
    reward: { coins: 10 },
  },
];

const events: WorldEvent[] = [];
let eventSeq = 0;

const timeState: TimeState = { phase: 'day', hour: 12, real: true };
const weatherState: WeatherState = {
  kind: 'clear',
  tempC: 15,
  real: true,
  summary: '15°C and clear in San Francisco right now',
};

const player: PlayerState = {
  id: 'player',
  name: 'Traveller',
  pos: { ...SPAWN },
  rot: 0,
  anim: 'idle',
  inventory: { coin: 12, 'cracked-blade': 1 },
};

// ── reads ───────────────────────────────────────────────────────────────────

export function worldSnapshot(): World {
  return {
    time: { ...timeState },
    weather: { ...weatherState },
    npcs,
    animals,
    objects,
    quests,
    players: [player],
    recentEvents: events.slice(-50),
  };
}

export const listNpcs = (): Npc[] => npcs;
export const getNpc = (id: string): Npc | undefined => npcs.find((n) => n.id === id);
export const listAnimals = (): Animal[] => animals;
export const listObjects = (): WObject[] => objects;
export const listQuests = (): Quest[] => quests;
export const getQuest = (id: string): Quest | undefined => quests.find((q) => q.id === id);
export const getPlayer = (): PlayerState => player;
export const getTime = (): TimeState => timeState;
export const getWeather = (): WeatherState => weatherState;

export function listEvents(opts: { since?: number; limit?: number; types?: string[] } = {}): WorldEvent[] {
  const since = opts.since ?? 0;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let out = events.filter((e) => e.id > since);
  if (opts.types && opts.types.length) out = out.filter((e) => opts.types!.includes(e.type));
  return out.slice(0, limit);
}

export const recentEventSummaries = (n = 12): string[] => events.slice(-n).map((e) => e.summary);

// ── mutators (append event + broadcast frame) ───────────────────────────────

export function addEvent(
  type: WorldEvent['type'],
  summary: string,
  actor?: string,
  data?: Record<string, unknown>,
): WorldEvent {
  const e: WorldEvent = { id: ++eventSeq, at: Date.now(), type, summary };
  if (actor !== undefined) e.actor = actor;
  if (data !== undefined) e.data = data;
  events.push(e);
  if (events.length > 500) events.shift(); // ring buffer
  broadcast({ t: 'event', event: e });
  for (const l of eventListeners) {
    try {
      l(e);
    } catch {
      /* a broken listener must not stop the world */
    }
  }
  return e;
}

export function setWeather(next: WeatherState, opts: { event?: string; actor?: string } = {}): WeatherState {
  Object.assign(weatherState, next);
  broadcast({ t: 'weather', weather: { ...weatherState } });
  if (opts.event) {
    addEvent('weather.changed', opts.event, opts.actor ?? 'world', {
      kind: weatherState.kind,
      tempC: weatherState.tempC,
      real: weatherState.real,
    });
  }
  return weatherState;
}

const PHASE_LINES: Record<TimePhase, string> = {
  dawn: 'Dawn breaks over Ashford',
  day: 'Morning sun — a new day in Ashford',
  dusk: 'Dusk settles over Ashford',
  night: 'Night falls on Ashford; the lamps flicker on',
};

export function setTime(next: TimeState): TimeState {
  const phaseChanged = next.phase !== timeState.phase;
  const changed = phaseChanged || next.hour !== timeState.hour || next.real !== timeState.real;
  Object.assign(timeState, next);
  if (changed) broadcast({ t: 'time', time: { ...timeState } });
  if (phaseChanged) {
    addEvent('time.phase', PHASE_LINES[timeState.phase], 'world', { phase: timeState.phase, hour: timeState.hour });
  }
  return timeState;
}

export function spawnObject(
  kind: ObjectKind,
  pos: Vec3,
  spawnedBy: string,
  ttlS?: number,
  summary?: string,
): WObject {
  const obj: WObject = { id: nextId('obj'), kind, pos, spawnedBy };
  if (ttlS && ttlS > 0) obj.expiresAt = Date.now() + ttlS * 1000;
  objects.push(obj);
  addEvent('object.spawned', summary ?? `A ${kind} appeared near the plaza`, spawnedBy, { id: obj.id, kind });
  broadcast({ t: 'object', op: 'add', object: obj });
  return obj;
}

export function removeObject(id: string, summary?: string): WObject | undefined {
  const idx = objects.findIndex((o) => o.id === id);
  if (idx < 0) return undefined;
  const [obj] = objects.splice(idx, 1);
  addEvent('object.removed', summary ?? `The ${obj.kind} is gone`, 'world', { id: obj.id, kind: obj.kind });
  broadcast({ t: 'object', op: 'remove', object: obj });
  return obj;
}

/** NPC speaks a one-shot line in-world (ambient director, /say puppeteering). */
export function npcAmbientSay(npcId: string, text: string, emotion: Emotion = 'neutral'): Npc | undefined {
  const npc = getNpc(npcId);
  if (!npc) return undefined;
  npc.mood = emotion;
  broadcast({ t: 'bubble', who: npcId, text, emotion, mode: 'ambient' });
  addEvent('npc.said', `${npc.name} said: "${text.slice(0, 120)}"`, npcId);
  return npc;
}

/** Final line of a brokered conversation (dialogue.ts calls this on commit). */
export function npcCommitSaid(npcId: string, convId: string, text: string, emotion: Emotion): void {
  const npc = getNpc(npcId);
  if (!npc) return;
  npc.mood = emotion;
  broadcast({ t: 'bubble', who: npcId, convId, text, emotion, mode: 'commit' });
  addEvent('npc.said', `${npc.name} said: "${text.slice(0, 120)}"`, npcId);
}

// ── quests ──────────────────────────────────────────────────────────────────

export function addQuest(q: Quest): Quest {
  quests.push(q);
  addEvent('quest.created', `A new notice is on the board: "${q.title}"`, q.giver, { questId: q.id, title: q.title });
  broadcast({ t: 'quest', quest: q });
  return q;
}

export function acceptQuest(id: string): { quest?: Quest; error?: string } {
  const q = getQuest(id);
  if (!q) return { error: `unknown quest "${id}"` };
  if (q.state !== 'offered') return { error: `quest "${id}" is ${q.state}, not offered` };
  q.state = 'active';
  addEvent('quest.accepted', `${player.name} accepted the quest "${q.title}"`, player.id, { questId: q.id });
  broadcast({ t: 'quest', quest: q });
  return { quest: q };
}

export function advanceQuest(id: string, stepId?: string): { quest?: Quest; step?: QuestStep; error?: string } {
  const q = getQuest(id);
  if (!q) return { error: `unknown quest "${id}"` };
  if (q.state === 'done') return { error: `quest "${id}" is already done` };
  const step = stepId ? q.steps.find((s) => s.id === stepId) : q.steps.find((s) => !s.done);
  if (!step) return { error: stepId ? `unknown step "${stepId}"` : 'no undone steps left' };
  if (step.done) return { error: `step "${step.id}" is already done` };
  step.done = true;
  addEvent('quest.step', `Quest "${q.title}": ${step.text} — done!`, player.id, { questId: q.id, stepId: step.id });
  if (q.steps.every((s) => s.done)) {
    q.state = 'done';
    player.inventory['coin'] = (player.inventory['coin'] ?? 0) + q.reward.coins;
    if (q.reward.item) player.inventory[q.reward.item] = (player.inventory[q.reward.item] ?? 0) + 1;
    addEvent(
      'quest.completed',
      `Quest "${q.title}" complete! ${q.reward.coins} coins for ${player.name}`,
      player.id,
      { questId: q.id, coins: q.reward.coins },
    );
  }
  broadcast({ t: 'quest', quest: q });
  return { quest: q, step };
}

/** 'talk' steps auto-complete when the player talks to that NPC (broker hook). */
export function questsAutoTalk(npcId: string): void {
  for (const q of quests) {
    if (q.state !== 'active') continue;
    const step = q.steps.find((s) => !s.done);
    if (step && step.kind === 'talk' && step.target === npcId) advanceQuest(q.id, step.id);
  }
}

/** 'goto' steps auto-complete when the player stands within 3m of the POI (sim tick). */
export function questsAutoGoto(): void {
  for (const q of quests) {
    if (q.state !== 'active') continue;
    const step = q.steps.find((s) => !s.done);
    if (!step || step.kind !== 'goto') continue;
    const p = poi(step.target);
    if (!p) continue;
    if (Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z) <= 3) advanceQuest(q.id, step.id);
  }
}

/** 'collect' steps auto-complete when the inventory holds the item (give hook + sim tick). */
export function questsAutoCollect(): void {
  for (const q of quests) {
    if (q.state !== 'active') continue;
    const step = q.steps.find((s) => !s.done);
    if (!step || step.kind !== 'collect') continue;
    if ((player.inventory[step.target] ?? 0) > 0) advanceQuest(q.id, step.id);
  }
}

// ── player ──────────────────────────────────────────────────────────────────

export function playerHello(name: string): PlayerState {
  player.name = (name || 'Traveller').slice(0, 32);
  player.pos = { ...SPAWN };
  player.rot = 0;
  player.anim = 'idle';
  addEvent('player.joined', `${player.name} stepped off the boat at the docks`, player.id, { name: player.name });
  return player;
}

export function updatePlayerPose(pos: Vec3, rot: number, anim: PlayerState['anim']): void {
  if (typeof pos?.x !== 'number' || typeof pos?.z !== 'number') return;
  player.pos = { x: pos.x, y: typeof pos.y === 'number' ? pos.y : heightAt(pos.x, pos.z), z: pos.z };
  if (typeof rot === 'number') player.rot = rot;
  if (anim === 'idle' || anim === 'walk' || anim === 'run') player.anim = anim;
}

export function givePlayer(item: string, n = 1): PlayerState {
  player.inventory[item] = (player.inventory[item] ?? 0) + n;
  addEvent('mcp.custom', `${player.name} received ${n}× ${item}`, 'mcp', { item, n });
  questsAutoCollect();
  return player;
}
