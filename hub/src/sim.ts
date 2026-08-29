/**
 * The 10 Hz sim: NPC routine movement, animal state machines, pose frames,
 * object lifetimes, quest auto-advance, and the rule-based ambient director
 * (zero LLM cost — canned pools + tiny scenes every 60-90s).
 */
import type { Animal, Npc, TimePhase, Vec3 } from '../../shared/protocol';
import { canStep, heightAt, isRoad, poi, POI_LABELS, randomWalkableNear } from '../../shared/island';
import { findPath } from './nav';
import { NPC_SEEDS, type NpcSeed, type RoutineStop } from './npcs';
import {
  addEvent,
  broadcast,
  getNpc,
  getPlayer,
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
const NPC_SPEED = 2.1; // m/s — the city is big now, villagers hustle a little
const STROLL_SPEED = 0.9; // m/s — casual shuffle while lingering at a stop
const NPC_MIN_GAP = 1.0; // m — closer than this reads as "standing inside each other"
const SPOT_GAP = 1.6; // m — min spacing between chosen standing spots
const STOP_RADIUS = 2.8; // m — how widely a routine stop fans out around its POI
const ENGAGE_MS = 12_000; // player-conversation hold; the client refreshes it while the talk UI is open
const ENGAGE_BREAK_DIST = 9; // m — the player walking off ends the conversation hold

// ── NPC runtime ─────────────────────────────────────────────────────────────

interface NpcRt {
  seed: NpcSeed;
  npc: Npc;
  phase: TimePhase;
  stop: RoutineStop | null;
  target: Vec3 | null;
  /** nav-grid waypoints toward `target` (last entry = the exact target) */
  path: Vec3[];
  /** seconds spent barely moving while en route — the anti-jiggle watchdog */
  stuckT: number;
  /** one re-path already spent on the current leg */
  repathed: boolean;
  dwellUntil: number;
  /** POI forced via POST /api/npcs/:id/goto — overrides the routine once */
  forced: string | null;
  /** short shuffle to a nearby spot while dwelling — does not touch the routine */
  stroll: Vec3 | null;
  /** hard hold (chat choreography): no strolling, no new stops, keep facing */
  parkedUntil: number;
  /** talking with the player: stand still, keep facing them (tracks movement) */
  engagedUntil: number;
  /** next time the idle-life roll fires (stroll / glance / funny fidget) */
  nextIdleAt: number;
}

/** Route rt toward dest along the nav grid (straight steering as fallback). */
function routeTo(rt: NpcRt, dest: Vec3): void {
  rt.target = dest;
  rt.path = findPath(rt.npc.pos, dest) ?? [dest];
  rt.stuckT = 0;
  rt.repathed = false;
}

function clearWalk(rt: NpcRt): void {
  rt.target = null;
  rt.path = [];
  rt.stuckT = 0;
  rt.repathed = false;
}

const npcRts: NpcRt[] = [];

/** Spots other NPCs have claimed: where they stand, or where they are headed. */
function claimedSpots(except: NpcRt): Vec3[] {
  const spots: Vec3[] = [];
  for (const o of npcRts) {
    if (o === except) continue;
    spots.push(o.stroll ?? o.target ?? o.npc.pos);
  }
  return spots;
}

/**
 * A walkable open spot near (x, z) that keeps SPOT_GAP from every other NPC's
 * claimed spot — so a crowded POI fans out into a loose group instead of a
 * pile. Falls back to the least-cramped sample when the area is packed.
 */
function pickSpotNear(rt: NpcRt, x: number, z: number, radius: number): Vec3 {
  let best: Vec3 | null = null;
  let bestScore = -1;
  const others = claimedSpots(rt);
  for (let i = 0; i < 16; i++) {
    const c = randomWalkableNear(x, z, radius);
    let nearest = Infinity;
    for (const s of others) nearest = Math.min(nearest, dist2d(c.x, c.z, s.x, s.z));
    // Nobody idles in the middle of a street: road spots never win over any
    // clean sample, but stay pickable as the last resort so a POI hemmed in
    // by asphalt can't strand its routine. (Walking across roads is fine.)
    if (isRoad(c.x, c.z)) nearest -= 100;
    else if (nearest >= SPOT_GAP) return c;
    if (nearest > bestScore) {
      bestScore = nearest;
      best = c;
    }
  }
  return best ?? randomWalkableNear(x, z, radius);
}

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
  // No backwards fallback: stepping back one tick and forward the next reads
  // as jiggling. Boxed in = hold still; callers watch for that and re-path.
  for (const off of [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7]) {
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

/**
 * Idle life while dwelling at a stop: shuffle to a fresh nearby spot, glance
 * at a neighbor or off into the distance, or do something quietly ridiculous
 * (the seed's fidget pool) so nobody stands frozen for a minute straight.
 */
function idleLife(rt: NpcRt, now: number): void {
  if (now < rt.nextIdleAt) return;
  rt.nextIdleAt = now + rand(8_000, 18_000);
  const { npc } = rt;
  const roll = Math.random();
  if (roll < 0.4 && rt.stop) {
    const p = poi(rt.stop.poi);
    if (p) rt.stroll = pickSpotNear(rt, p.pos.x, p.pos.z, STOP_RADIUS);
  } else if (roll < 0.65 && rt.seed.fidgets.length) {
    setActivity(npc, pick(rt.seed.fidgets));
  } else {
    // people-watch: face the nearest neighbor when one is close, else gaze off
    let nearest: Npc | null = null;
    let nd = 7;
    for (const o of npcRts) {
      if (o === rt) continue;
      const d = dist2d(npc.pos.x, npc.pos.z, o.npc.pos.x, o.npc.pos.z);
      if (d < nd) {
        nd = d;
        nearest = o.npc;
      }
    }
    npc.rot = nearest
      ? Math.atan2(nearest.pos.x - npc.pos.x, nearest.pos.z - npc.pos.z)
      : rand(0, Math.PI * 2);
  }
}

function tickNpc(rt: NpcRt, now: number, dt: number, phase: TimePhase): void {
  const { npc } = rt;
  if (phase !== rt.phase && !rt.forced) {
    rt.phase = phase;
    rt.stop = null;
    clearWalk(rt);
    rt.stroll = null;
    rt.dwellUntil = 0; // phase change: pick a fresh stop right away
  }

  // Talking with the player: freeze in place and keep facing them, tracking
  // as they shuffle around. Ends when the hold expires (the client refreshes
  // it while the talk UI is open) or the player simply walks away.
  if (rt.engagedUntil) {
    const p = getPlayer();
    const d = dist2d(npc.pos.x, npc.pos.z, p.pos.x, p.pos.z);
    if (now >= rt.engagedUntil || d > ENGAGE_BREAK_DIST) {
      rt.engagedUntil = 0;
      // linger a beat after the goodbye instead of spinning away instantly
      rt.dwellUntil = Math.max(rt.dwellUntil, now + rand(2_000, 6_000));
      rt.nextIdleAt = now + rand(4_000, 9_000);
    } else {
      clearWalk(rt);
      rt.stroll = null;
      npc.anim = 'idle';
      if (d > 0.25) npc.rot = Math.atan2(p.pos.x - npc.pos.x, p.pos.z - npc.pos.z);
      return;
    }
  }

  if (rt.target) {
    npc.anim = 'walk';
    const px = npc.pos.x, pz = npc.pos.z;
    const wp = rt.path[0] ?? rt.target;
    if (stepToward(npc, wp, NPC_SPEED, dt)) {
      if (rt.path.length > 1) { rt.path.shift(); return; } // next corner
      clearWalk(rt);
      rt.stroll = null;
      rt.dwellUntil = now + rand(12_000, 35_000);
      rt.nextIdleAt = now + rand(5_000, 12_000);
      npc.anim = 'idle';
      if (rt.forced) {
        const label = POI_LABELS[rt.forced] ?? rt.forced;
        rt.forced = null;
        setActivity(npc, `lingering by ${label}`);
      } else if (rt.stop) {
        setActivity(npc, rt.stop.activity);
      }
      return;
    }
    // Anti-jiggle watchdog: barely moving while en route means we're wedged
    // (a crowd, a wall the steering can't slide around). Re-path once around
    // it; if that doesn't free us, drop the walk and let the routine retry.
    if (dist2d(px, pz, npc.pos.x, npc.pos.z) < NPC_SPEED * dt * 0.25) {
      rt.stuckT += dt;
      if (rt.stuckT > 1.5 && !rt.repathed) {
        rt.repathed = true;
        rt.path = findPath(npc.pos, rt.target) ?? [rt.target];
      } else if (rt.stuckT > 4) {
        clearWalk(rt);
        npc.anim = 'idle';
        rt.dwellUntil = now + rand(3_000, 8_000);
      }
    } else {
      rt.stuckT = 0;
    }
    return;
  }

  // parked for a conversation — hold the pose, keep facing the other speaker
  if (now < rt.parkedUntil) {
    npc.anim = 'idle';
    return;
  }

  // mid-dwell shuffle: amble a few steps without touching the routine
  if (rt.stroll) {
    npc.anim = 'walk';
    const px = npc.pos.x, pz = npc.pos.z;
    if (stepToward(npc, rt.stroll, STROLL_SPEED, dt)) {
      rt.stroll = null;
      npc.anim = 'idle';
      rt.stuckT = 0;
    } else if (dist2d(px, pz, npc.pos.x, npc.pos.z) < STROLL_SPEED * dt * 0.25) {
      rt.stuckT += dt;
      if (rt.stuckT > 1.2) { rt.stroll = null; npc.anim = 'idle'; rt.stuckT = 0; }
    } else {
      rt.stuckT = 0;
    }
    return;
  }

  npc.anim = 'idle';
  if (now < rt.dwellUntil) {
    idleLife(rt, now);
    return;
  }

  const stop = pickStop(rt, phase);
  rt.stop = stop;
  const p = poi(stop.poi);
  if (!p) return;
  routeTo(rt, pickSpotNear(rt, p.pos.x, p.pos.z, STOP_RADIUS));
  if (dist2d(npc.pos.x, npc.pos.z, rt.target!.x, rt.target!.z) > 2) {
    setActivity(npc, `walking to ${POI_LABELS[stop.poi] ?? stop.poi}`);
  }
}

/**
 * The player walked up to talk (E in the client, a WS talk frame, or a
 * brokered turn): the NPC stops whatever it was doing and holds facing the
 * player. Called repeatedly while the talk UI is open, so the hold slides
 * forward; tickNpc releases it on timeout or when the player walks away.
 */
export function engagePlayer(npcId: string): Npc | undefined {
  const rt = npcRts.find((r) => r.npc.id === npcId);
  if (!rt) return undefined;
  const fresh = rt.engagedUntil <= Date.now();
  rt.engagedUntil = Date.now() + ENGAGE_MS;
  rt.parkedUntil = 0;
  rt.forced = null;
  clearWalk(rt);
  rt.stroll = null;
  rt.npc.anim = 'idle';
  if (fresh) setActivity(rt.npc, `chatting with ${getPlayer().name}`);
  return rt.npc;
}

/** POST /api/npcs/:id/goto — walk there now, then resume the routine. */
export function sendNpcTo(npcId: string, poiId: string): Npc | undefined {
  const rt = npcRts.find((r) => r.npc.id === npcId);
  const p = poi(poiId);
  if (!rt || !p) return undefined;
  rt.forced = poiId;
  rt.stop = null;
  rt.stroll = null;
  rt.parkedUntil = 0;
  rt.engagedUntil = 0;
  routeTo(rt, pickSpotNear(rt, p.pos.x, p.pos.z, 1.8));
  rt.dwellUntil = 0;
  setActivity(rt.npc, `walking to ${POI_LABELS[poiId] ?? poiId}`);
  return rt.npc;
}

// ── NPC↔NPC chatter choreography (used by chatter.ts) ──────────────────────

/** A spot a polite conversational distance (≥0.9m) from `pos`. */
function chatSpotNear(pos: Vec3): Vec3 {
  for (let i = 0; i < 12; i++) {
    const c = randomWalkableNear(pos.x, pos.z, 1.3);
    if (dist2d(c.x, c.z, pos.x, pos.z) >= 0.9) return c;
  }
  return randomWalkableNear(pos.x, pos.z, 1.3);
}

/** Walk `a` over to `b`; `b` waits in place. Returns false if either is unknown. */
export function summonForChat(aId: string, bId: string): boolean {
  const ra = npcRts.find((r) => r.npc.id === aId);
  const rb = npcRts.find((r) => r.npc.id === bId);
  if (!ra || !rb) return false;
  clearWalk(rb);
  rb.stroll = null;
  rb.forced = null;
  rb.engagedUntil = 0;
  rb.parkedUntil = Date.now() + 40_000; // long enough for the walk over
  rb.dwellUntil = rb.parkedUntil;
  ra.forced = null;
  ra.stop = null;
  ra.stroll = null;
  ra.parkedUntil = 0;
  ra.engagedUntil = 0;
  ra.dwellUntil = 0;
  routeTo(ra, chatSpotNear(rb.npc.pos));
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
    clearWalk(me);
    me.stroll = null;
    me.forced = null;
    me.engagedUntil = 0;
    me.parkedUntil = until;
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
    if (!rt) continue;
    rt.parkedUntil = 0;
    rt.dwellUntil = Date.now() + rand(2_000, 6_000);
  }
}

/**
 * Personal space: any two NPCs closer than NPC_MIN_GAP get eased apart along
 * the line between them (capped speed, so it reads as a polite shuffle, not a
 * teleport). The push is axial, so a chatting pair keeps facing each other.
 */
function separateNpcs(dt: number): void {
  for (let i = 0; i < npcRts.length; i++) {
    for (let j = i + 1; j < npcRts.length; j++) {
      const a = npcRts[i].npc;
      const b = npcRts[j].npc;
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= NPC_MIN_GAP) continue;
      if (d < 1e-4) {
        // perfectly stacked: deterministic angle so the pair always resolves
        const ang = i * 2.4 + j * 1.7;
        dx = Math.sin(ang);
        dz = Math.cos(ang);
      } else {
        dx /= d;
        dz /= d;
      }
      const step = Math.min(1.2 * dt, (NPC_MIN_GAP - d) * 0.5 + 0.01);
      for (const [e, s] of [
        [a, -step],
        [b, step],
      ] as const) {
        const nx = e.pos.x + dx * s;
        const nz = e.pos.z + dz * s;
        if (!canStep(e.pos.x, e.pos.z, nx, nz)) continue;
        e.pos.x = nx;
        e.pos.z = nz;
        e.pos.y = heightAt(nx, nz);
      }
    }
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
  nextAmbientAt = now + rand(45_000, 75_000);
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
    npcRts.push({
      seed,
      npc,
      phase: getTime().phase,
      stop: null,
      target: null,
      path: [],
      stuckT: 0,
      repathed: false,
      dwellUntil: 0,
      forced: null,
      stroll: null,
      parkedUntil: 0,
      engagedUntil: 0,
      nextIdleAt: 0,
    });
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
  nextAmbientAt = Date.now() + rand(45_000, 75_000);

  let last = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - last) / 1000, 0.5);
    last = now;
    const phase = getTime().phase;

    for (const rt of npcRts) tickNpc(rt, now, dt, phase);
    separateNpcs(dt);
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
