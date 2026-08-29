/**
 * The 10 Hz sim: NPC routine movement, animal state machines, pose frames,
 * object lifetimes, quest auto-advance, and the rule-based ambient director
 * (zero LLM cost — canned pools + tiny scenes every 60-90s).
 */
import type { Animal, Npc, TimePhase, Vec3 } from '../../shared/protocol';
import { canStep, heightAt, poi, POI_LABELS, randomWalkableNear } from './island';
import { NPC_SEEDS, type NpcSeed, type RoutineStop } from './npcs';
import {
  addEvent,
  broadcast,
  getNpc,
  getTime,
  getWeather,
  listAnimals,
  listObjects,
  npcAmbientSay,
  questsAutoCollect,
  questsAutoGoto,
  removeObject,
} from './state';
import { dist2d, pick, rand, round2 } from './util';

const TICK_MS = 100;
const NPC_SPEED = 1.6; // m/s

// ── NPC runtime ─────────────────────────────────────────────────────────────

interface NpcRt {
  seed: NpcSeed;
  npc: Npc;
  phase: TimePhase;
  stop: RoutineStop | null;
  target: Vec3 | null;
  dwellUntil: number;
  /** POI forced via POST /api/npcs/:id/goto — overrides the routine once */
  forced: string | null;
}

const npcRts: NpcRt[] = [];

function pickStop(rt: NpcRt, phase: TimePhase): RoutineStop {
  const stops = rt.seed.routine[phase];
  const candidates = stops.length > 1 && rt.stop ? stops.filter((s) => s !== rt.stop) : stops;
  const total = candidates.reduce((s, c) => s + (c.w ?? 1), 0);
  let roll = Math.random() * total;
  for (const c of candidates) {
    roll -= c.w ?? 1;
    if (roll <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

function setActivity(npc: Npc, activity: string): void {
  if (npc.activity === activity) return; // throttle: only on change
  npc.activity = activity;
  addEvent('npc.action', `${npc.name} is ${activity}`, npc.id);
}

/**
 * One steering step toward `target`. Straight line when clear; when the next
 * tile is blocked (water or a >1 step), nudge the heading sideways until a
 * walkable direction appears. Returns true when arrived.
 */
function stepToward(e: { pos: Vec3; rot: number }, target: Vec3, speed: number, dt: number): boolean {
  const dx = target.x - e.pos.x;
  const dz = target.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.18) {
    e.pos.x = target.x;
    e.pos.z = target.z;
    e.pos.y = heightAt(target.x, target.z);
    return true;
  }
  const step = Math.min(speed * dt, d);
  const base = Math.atan2(dx, dz);
  for (const off of [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7, Math.PI]) {
    const a = base + off;
    const nx = e.pos.x + Math.sin(a) * step;
    const nz = e.pos.z + Math.cos(a) * step;
    if (!canStep(e.pos.x, e.pos.z, nx, nz)) continue;
    e.pos.x = nx;
    e.pos.z = nz;
    e.pos.y = heightAt(nx, nz);
    e.rot = a;
    return false;
  }
  return false; // boxed in — hold still this tick
}

function tickNpc(rt: NpcRt, now: number, dt: number, phase: TimePhase): void {
  const { npc } = rt;
  if (phase !== rt.phase && !rt.forced) {
    rt.phase = phase;
    rt.stop = null;
    rt.target = null;
    rt.dwellUntil = 0; // phase change: pick a fresh stop right away
  }

  if (rt.target) {
    npc.anim = 'walk';
    if (stepToward(npc, rt.target, NPC_SPEED, dt)) {
      rt.target = null;
      rt.dwellUntil = now + rand(20_000, 60_000);
      npc.anim = 'idle';
      if (rt.forced) {
        const label = POI_LABELS[rt.forced] ?? rt.forced;
        rt.forced = null;
        setActivity(npc, `lingering by ${label}`);
      } else if (rt.stop) {
        setActivity(npc, rt.stop.activity);
      }
    }
    return;
  }

  npc.anim = 'idle';
  if (now < rt.dwellUntil) return;

  const stop = pickStop(rt, phase);
  rt.stop = stop;
  const p = poi(stop.poi);
  if (!p) return;
  rt.target = randomWalkableNear(p.pos.x, p.pos.z, 1.6);
  if (dist2d(npc.pos.x, npc.pos.z, rt.target.x, rt.target.z) > 2) {
    setActivity(npc, `walking to ${POI_LABELS[stop.poi] ?? stop.poi}`);
  }
}

/** POST /api/npcs/:id/goto — walk there now, then resume the routine. */
export function sendNpcTo(npcId: string, poiId: string): Npc | undefined {
  const rt = npcRts.find((r) => r.npc.id === npcId);
  const p = poi(poiId);
  if (!rt || !p) return undefined;
  rt.forced = poiId;
  rt.stop = null;
  rt.target = randomWalkableNear(p.pos.x, p.pos.z, 1.4);
  rt.dwellUntil = 0;
  setActivity(rt.npc, `walking to ${POI_LABELS[poiId] ?? poiId}`);
  return rt.npc;
}

// ── NPC↔NPC chatter choreography (used by chatter.ts) ──────────────────────

/** Walk `a` over to `b`; `b` waits in place. Returns false if either is unknown. */
export function summonForChat(aId: string, bId: string): boolean {
  const ra = npcRts.find((r) => r.npc.id === aId);
  const rb = npcRts.find((r) => r.npc.id === bId);
  if (!ra || !rb) return false;
  rb.target = null;
  rb.forced = null;
  rb.dwellUntil = Date.now() + 40_000; // long enough for the walk over
  ra.forced = null;
  ra.stop = null;
  ra.dwellUntil = 0;
  ra.target = randomWalkableNear(rb.npc.pos.x, rb.npc.pos.z, 1.3);
  setActivity(ra.npc, `heading over to ${rb.npc.name}`);
  return true;
}

/** Park both for the conversation: no wandering, facing each other. */
export function holdFacing(aId: string, bId: string, holdMs: number): void {
  const ra = npcRts.find((r) => r.npc.id === aId);
  const rb = npcRts.find((r) => r.npc.id === bId);
  if (!ra || !rb) return;
  const until = Date.now() + holdMs;
  for (const [me, other] of [[ra, rb], [rb, ra]] as const) {
    me.target = null;
    me.forced = null;
    me.dwellUntil = until;
    me.npc.anim = 'idle';
    me.npc.rot = Math.atan2(other.npc.pos.x - me.npc.pos.x, other.npc.pos.z - me.npc.pos.z);
    setActivity(me.npc, `chatting with ${other.npc.name}`);
  }
}

/** Let a pair drift back to their routines shortly after a conversation. */
export function releaseFromChat(ids: string[]): void {
  for (const id of ids) {
    const rt = npcRts.find((r) => r.npc.id === id);
    if (rt) rt.dwellUntil = Date.now() + rand(2_000, 6_000);
  }
}

// ── animals ─────────────────────────────────────────────────────────────────

interface ChickenRt {
  a: Animal;
  mode: 'peck' | 'wander';
  until: number;
  target: Vec3 | null;
  escapedUntil: number; // 0 = safely penned
}
interface CatRt {
  a: Animal;
  mode: 'wander' | 'nap' | 'chase';
  until: number;
  target: Vec3 | null;
  anchor: 'plaza' | 'market';
  chasing: string | null;
}
interface FlyRt {
  a: Animal;
  anchor: 'flowerpatch' | 'plaza';
  theta: number;
  radius: number;
  speed: number;
  switchAt: number;
}

const chickens: ChickenRt[] = [];
let cat: CatRt | null = null;
const flies: FlyRt[] = [];

const penP = () => poi('pen')!.pos;

function penPoint(): Vec3 {
  const p = penP();
  return { x: p.x + rand(-1.2, 1.2), y: p.y, z: p.z + rand(-1.2, 1.2) };
}

function tickChicken(c: ChickenRt, now: number, dt: number): void {
  if (c.escapedUntil && now > c.escapedUntil) {
    c.escapedUntil = 0;
    c.target = penPoint();
    c.mode = 'wander';
    addEvent('animal.action', 'The runaway chicken was herded back into the pen, looking very smug', c.a.id);
  }
  if (c.mode === 'peck') {
    c.a.state = 'peck';
    if (now > c.until) {
      c.mode = 'wander';
      c.target = c.escapedUntil ? c.target : penPoint();
    }
    return;
  }
  c.a.state = 'wander';
  if (!c.target) c.target = penPoint();
  if (stepToward(c.a, c.target, 0.55, dt)) {
    c.target = null;
    c.mode = 'peck';
    c.until = now + rand(2_000, 6_000);
  }
}

function tickCat(c: CatRt, now: number, dt: number): void {
  if (c.mode === 'nap') {
    c.a.state = 'nap';
    if (now > c.until) c.mode = 'wander';
    return;
  }
  if (c.mode === 'chase') {
    c.a.state = 'chase';
    const fly = flies.find((f) => f.a.id === c.chasing);
    if (!fly || now > c.until) {
      c.mode = 'wander';
      c.chasing = null;
      c.target = null;
      return;
    }
    stepToward(c.a, { x: fly.a.pos.x, y: c.a.pos.y, z: fly.a.pos.z }, 2.2, dt);
    return;
  }
  c.a.state = 'wander';
  if (!c.target) {
    c.anchor = Math.random() < 0.5 ? 'plaza' : 'market';
    const p = poi(c.anchor)!.pos;
    c.target = randomWalkableNear(p.x, p.z, 3);
  }
  if (stepToward(c.a, c.target, 0.8, dt)) {
    c.target = null;
    if (Math.random() < 0.3) {
      c.mode = 'nap';
      c.until = now + 30_000;
      addEvent('animal.action', `The cat curled up for a nap by ${POI_LABELS[c.anchor]}`, c.a.id);
    }
  }
}

function tickFly(f: FlyRt, now: number): void {
  if (now > f.switchAt) {
    f.anchor = f.anchor === 'flowerpatch' ? 'plaza' : 'flowerpatch';
    f.switchAt = now + rand(40_000, 90_000);
  }
  f.theta += f.speed * (TICK_MS / 1000);
  f.radius += rand(-0.06, 0.06);
  f.radius = Math.min(3.2, Math.max(0.8, f.radius));
  const p = poi(f.anchor)!.pos;
  const nx = p.x + Math.sin(f.theta) * f.radius;
  const nz = p.z + Math.cos(f.theta) * f.radius;
  f.a.rot = Math.atan2(nx - f.a.pos.x, nz - f.a.pos.z);
  f.a.pos.x = nx;
  f.a.pos.z = nz;
  f.a.pos.y = heightAt(nx, nz) + 1.1 + 0.35 * Math.sin(now / 700 + f.theta);
  f.a.state = 'flutter';
}

// ── ambient director ────────────────────────────────────────────────────────

let nextAmbientAt = 0;
let lastAmbientLine = '';

function catChaseScene(): void {
  if (!cat || cat.mode === 'chase' || flies.length === 0) return;
  const fly = pick(flies);
  cat.mode = 'chase';
  cat.chasing = fly.a.id;
  cat.until = Date.now() + 6_000;
  addEvent('animal.action', 'The cat is chasing a butterfly around the plaza!!', cat.a.id);
}

function chickenEscapeScene(): void {
  const c = chickens.find((ch) => !ch.escapedUntil);
  if (!c) return;
  const p = penP();
  c.escapedUntil = Date.now() + 20_000;
  c.mode = 'wander';
  c.target = randomWalkableNear(p.x, p.z, 5);
  addEvent('animal.action', 'A chicken squeezed out of the pen and is loose on the farm!!', c.a.id);
}

function ambientBubbleScene(): void {
  const seed = pick(NPC_SEEDS);
  const kind = getWeather().kind;
  const pool = seed.ambient[kind] ?? seed.ambient.clear;
  let line = pick(pool);
  if (line === lastAmbientLine && pool.length > 1) line = pick(pool.filter((l) => l !== line));
  lastAmbientLine = line;
  npcAmbientSay(seed.id, line, seed.ambientEmotion[kind] ?? 'happy');
}

function runDirector(now: number): void {
  if (now < nextAmbientAt) return;
  nextAmbientAt = now + rand(60_000, 90_000);
  const roll = Math.random();
  if (roll < 0.5) ambientBubbleScene();
  else if (roll < 0.75) catChaseScene();
  else chickenEscapeScene();
}

// ── main loop ───────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

export function startSim(): void {
  if (timer) return;

  for (const seed of NPC_SEEDS) {
    const npc = getNpc(seed.id)!;
    npcRts.push({ seed, npc, phase: getTime().phase, stop: null, target: null, dwellUntil: 0, forced: null });
  }
  for (const a of listAnimals()) {
    if (a.kind === 'chicken') chickens.push({ a, mode: 'peck', until: 0, target: null, escapedUntil: 0 });
    else if (a.kind === 'cat') cat = { a, mode: 'wander', until: 0, target: null, anchor: 'plaza', chasing: null };
    else if (a.kind === 'butterfly')
      flies.push({
        a,
        anchor: flies.length % 2 ? 'plaza' : 'flowerpatch',
        theta: rand(0, Math.PI * 2),
        radius: rand(1, 2.5),
        speed: rand(0.6, 1.1),
        switchAt: Date.now() + rand(40_000, 90_000),
      });
  }
  nextAmbientAt = Date.now() + rand(60_000, 90_000);

  let last = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - last) / 1000, 0.5);
    last = now;
    const phase = getTime().phase;

    for (const rt of npcRts) tickNpc(rt, now, dt, phase);
    for (const c of chickens) tickChicken(c, now, dt);
    if (cat) tickCat(cat, now, dt);
    for (const f of flies) tickFly(f, now);

    // expired objects crumble away
    for (const o of [...listObjects()]) {
      if (o.expiresAt && now > o.expiresAt) removeObject(o.id, `The ${o.kind} crumbled away`);
    }

    questsAutoGoto();
    questsAutoCollect();
    runDirector(now);

    broadcast({
      t: 'pose',
      npcs: npcRts.map(({ npc }) => ({
        id: npc.id,
        pos: { x: round2(npc.pos.x), y: round2(npc.pos.y), z: round2(npc.pos.z) },
        rot: round2(npc.rot),
        anim: npc.anim,
      })),
      animals: listAnimals().map((a) => ({
        id: a.id,
        pos: { x: round2(a.pos.x), y: round2(a.pos.y), z: round2(a.pos.z) },
        rot: round2(a.rot),
        state: a.state,
      })),
    });
  }, TICK_MS);
}
