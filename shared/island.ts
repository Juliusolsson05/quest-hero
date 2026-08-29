/**
 * Ashford-by-the-Bay — a 96×96 voxel San Francisco, one voxel = 1m (SPEC §3).
 * The map is *generated* here (coastline distance fields + a street grid +
 * hand-placed landmarks), deterministically, which is why this file lives in
 * shared/: the hub simulates on it and the game meshes it locally without
 * waiting for (or needing) a hub — same code, same world, both sides. Only
 * pure generation and queries belong here; hub-side NPC routing is
 * hub/src/nav.ts, and neither game/ nor hub/ may import the other's src.
 *
 * Tiles:   ~ water   . grass   , dirt   : path   # sidewalk/plaza   s sand
 *          r street asphalt    b Golden Gate deck (walkable, water below)
 * Heights: '0'-'9' per column — water 0, beach/pier 1, city 2, hills 3-6.
 *
 * Geography (x east →, z south ↓):
 *   z 0-8    Marin headland (grassy hills, the vista point, cart spawn road)
 *   z 9-24   the strait — spanned by the Golden Gate ('b' deck tiles, x 46-48)
 *   z 25-91  the city peninsula: avenues N-S, streets E-W, parks, downtown,
 *            the Embarcadero hugging the bay coast, Twin Peaks in the southwest.
 */
import type { Island, Prop, PropKind, Vec3 } from './protocol';

export const SIZE = 96;

// ── deterministic hash so the same map grows every boot ─────────────────────
function hash01(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ── landmasses ──────────────────────────────────────────────────────────────
// City peninsula: soft superellipse. Marin: flat ellipse pinned to the top.
const cityF = (x: number, z: number): number =>
  Math.abs((x - 48) / 38) ** 2.4 + Math.abs((z - 58) / 33) ** 2.4;
const marinF = (x: number, z: number): number =>
  ((x - 48) / 17) ** 2 + ((z - 1) / 8) ** 2;

const AVENUES = [17, 27, 37, 47, 57, 67, 77]; // N-S road centers (3 wide)
const STREETS = [27, 37, 47, 57, 67, 77, 87]; // E-W road centers (3 wide)
const BRIDGE_X = [46, 47, 48];
const BRIDGE_Z0 = 9;
const BRIDGE_Z1 = 24;

// Named rectangles the residential auto-fill keeps out of.
const RECTS = {
  ggpark: { x0: 14, x1: 31, z0: 49, z1: 55 },   // Golden Gate Park
  alamo: { x0: 32, x1: 40, z0: 50, z1: 55 },    // Alamo Square (painted ladies)
  plaza: { x0: 49, x1: 55, z0: 42, z1: 45 },    // Union Square
  market: { x0: 39, x1: 45, z0: 39, z1: 45 },   // market block west of the plaza
  forgeBlk: { x0: 39, x1: 45, z0: 59, z1: 65 }, // craftsman corner
  farm: { x0: 18, x1: 27, z0: 74, z1: 84 },     // community farm
  downtown: { x0: 58, x1: 76, z0: 28, z1: 46 }, // FiDi towers
  peaks: { x0: 26, x1: 36, z0: 62, z1: 75 },    // Twin Peaks / Sutro
  ferryPad: { x0: 83, x1: 87, z0: 42, z1: 46 }, // Ferry Building pad on the bay
};

const HILLS = [
  { x: 30, z: 68, h: 4, r: 16 }, // Twin Peaks (Sutro Tower up top)
  { x: 44, z: 40, h: 2, r: 10 }, // Nob Hill
  { x: 63, z: 30, h: 2, r: 7 },  // Telegraph Hill (Coit)
  { x: 34, z: 57, h: 1, r: 8 },  // Alamo rise
  { x: 22, z: 82, h: 1, r: 9 },  // outer dunes
  { x: 48, z: 1, h: 2, r: 13 },  // Marin headlands
];

function generate(): { tiles: string[]; heights: string[] } {
  const g: string[][] = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('~'));
  const h: number[][] = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));

  // 1 ─ landmass, beaches, base heights
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const wob = (hash01(x, z) - 0.5) * 0.05;
      const fc = cityF(x, z) + wob;
      const fm = marinF(x, z) + wob;
      const city = fc <= 1;
      const marin = (fm <= 1 && z <= 8) || (x >= 43 && x <= 53 && z <= 8); // solid bridge landing
      if (!city && !marin) continue;
      const f = city ? fc : Math.min(fm, 0.5);
      const beach = f > 0.9;
      g[z][x] = beach ? 's' : '.';
      h[z][x] = beach ? 1 : 2;
      if (!beach) {
        let bump = 0;
        for (const hill of HILLS) {
          const d = Math.hypot(x - hill.x, z - hill.z);
          if (d < hill.r) bump += hill.h * (1 - d / hill.r);
        }
        h[z][x] = Math.min(8, 2 + Math.round(bump));
      }
    }
  }

  // 2 ─ flat approaches for the bridge (Crissy Field + the Marin road)
  for (let z = 0; z <= 8; z++) for (let x = 44; x <= 50; x++) { if (g[z][x] === '~') g[z][x] = '.'; g[z][x] = g[z][x] === 's' ? '.' : g[z][x]; h[z][x] = Math.max(2, h[z][x]); }
  for (let z = 25; z <= 29; z++) for (let x = 40; x <= 54; x++) { if (g[z][x] === '~') g[z][x] = '.'; g[z][x] = g[z][x] === 's' ? '.' : g[z][x]; h[z][x] = 2; }

  // 3 ─ relax slopes so every land step is at most one block
  for (let it = 0; it < 10; it++) {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (g[z][x] === '~') continue;
        let lo = Infinity;
        for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]] as const) {
          if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
          if (g[nz][nx] === '~') continue;
          lo = Math.min(lo, h[nz][nx]);
        }
        if (lo !== Infinity && h[z][x] > lo + 1) h[z][x] = lo + 1;
      }
    }
  }

  // 4 ─ the farm's tilled earth
  for (let z = RECTS.farm.z0; z <= RECTS.farm.z1; z++)
    for (let x = RECTS.farm.x0; x <= RECTS.farm.x1; x++)
      if (g[z][x] === '.') g[z][x] = ',';

  // 5 ─ streets: the grid, the Marin approach, the Embarcadero along the bay
  const road = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return;
    if (g[z][x] !== '~') g[z][x] = 'r';
  };
  for (const a of AVENUES) for (let z = 25; z < SIZE; z++) for (let dx = -1; dx <= 1; dx++) road(a + dx, z);
  for (const s of STREETS) for (let x = 12; x <= 86; x++) for (let dz = -1; dz <= 1; dz++) road(x, s + dz);
  for (let z = 0; z <= 8; z++) for (const x of BRIDGE_X) road(x, z); // Marin approach
  for (let z = 1; z <= 3; z++) for (let x = 43; x <= 52; x++) if (g[z][x] === '.') g[z][x] = '#'; // vista point
  for (let x = 40; x <= 54; x++) if (g[25][x] === '.') g[25][x] = '#'; // Golden Gate overlook pads
  for (let z = 28; z <= 80; z++) { // Embarcadero: 3 lanes tucked inside the bay coast
    let xe = -1;
    for (let x = SIZE - 1; x > 55; x--) if (g[z][x] !== '~') { xe = x; break; }
    if (xe < 60) continue;
    for (let x = xe - 3; x <= xe - 1; x++) road(x, z);
    if (g[z][xe] !== '~') g[z][xe] = '#'; // waterfront promenade
  }

  // 6 ─ the Golden Gate deck itself
  for (let z = BRIDGE_Z0; z <= BRIDGE_Z1; z++) for (const x of BRIDGE_X) { g[z][x] = 'b'; h[z][x] = 2; }

  // 7 ─ parks punch holes in the grid (roads route around them)
  for (const r of [RECTS.ggpark, RECTS.alamo]) {
    for (let z = r.z0; z <= r.z1; z++)
      for (let x = r.x0; x <= r.x1; x++)
        if (g[z][x] !== '~') g[z][x] = '.';
  }
  for (let x = RECTS.ggpark.x0; x <= RECTS.alamo.x1; x++) if (g[52][x] === '.') g[52][x] = ':'; // park promenade
  for (let z = 29; z <= 33; z++) if (g[z][62] === '.') g[z][62] = ':'; // Telegraph Hill stair-path

  // 8 ─ Union Square plaza
  for (let z = RECTS.plaza.z0; z <= RECTS.plaza.z1; z++)
    for (let x = RECTS.plaza.x0; x <= RECTS.plaza.x1; x++)
      if (g[z][x] !== '~') g[z][x] = '#';

  // 9 ─ piers + the Ferry Building pad (wood-sand over the bay, height 1)
  const pier = (x0: number, x1: number, z0: number, z1: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (g[z][x] === '~') { g[z][x] = 's'; h[z][x] = 1; }
  };
  pier(78, 85, 33, 34);
  pier(RECTS.ferryPad.x0, RECTS.ferryPad.x1, RECTS.ferryPad.z0, RECTS.ferryPad.z1);
  pier(84, 90, 52, 53);

  // 10 ─ sidewalks wherever grass touches asphalt
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      if (g[z][x] !== '.') continue;
      const near =
        (x > 0 && g[z][x - 1] === 'r') || (x < SIZE - 1 && g[z][x + 1] === 'r') ||
        (z > 0 && g[z - 1][x] === 'r') || (z < SIZE - 1 && g[z + 1][x] === 'r');
      if (near) g[z][x] = '#';
    }
  }

  return {
    tiles: g.map((row) => row.join('')),
    heights: h.map((row) => row.map((v) => String(v)).join('')),
  };
}

const GEN = generate();
const TILES: string[] = GEN.tiles;
const HEIGHTS: string[] = GEN.heights;

// ── POIs (all off-road, ids unchanged — routines/quests keep working) ───────
const POI_DEFS: { id: string; label: string; x: number; z: number }[] = [
  { id: 'plaza', label: 'the plaza', x: 52, z: 43.2 },
  { id: 'forge', label: 'the forge', x: 42.5, z: 61.5 },
  { id: 'market', label: 'the market', x: 42, z: 42 },
  { id: 'farm', label: 'the farm', x: 23, z: 79 },
  { id: 'docks', label: 'the Ferry Building', x: 85, z: 45.5 },
  { id: 'hill', label: 'the shrine hill', x: 61.5, z: 30.5 },
  { id: 'board', label: 'the notice board', x: 54.6, z: 42.6 },
  { id: 'mailbox', label: 'the mailbox', x: 49.4, z: 49.8 },
  { id: 'pen', label: 'the chicken pen', x: 20.5, z: 80.5 },
  { id: 'flowerpatch', label: 'the flower patch', x: 23, z: 50.6 },
  { id: 'sfrow', label: 'downtown', x: 62, z: 42 },
  { id: 'gate', label: 'the Golden Gate', x: 42, z: 25.4 },
  { id: 'irs', label: 'the startup office', x: 20.6, z: 52 },
];

// ── props ───────────────────────────────────────────────────────────────────
type PropDef = { kind: PropKind; x: number; z: number; rot?: number; scale?: number };
const PI = Math.PI;

function buildProps(): PropDef[] {
  const P: PropDef[] = [];
  const tile = (x: number, z: number) => TILES[Math.floor(z)]?.[Math.floor(x)] ?? '~';
  const landAt = (x: number, z: number) => { const t = tile(x, z); return t !== '~' && t !== 'b'; };

  // ── landmarks ──
  P.push({ kind: 'goldengate', x: 47.5, z: (BRIDGE_Z0 + BRIDGE_Z1 + 1) / 2 }); // spans the strait
  P.push({ kind: 'transamerica', x: 60.5, z: 34 });
  P.push({ kind: 'salesforce', x: 63.5, z: 44 });
  P.push({ kind: 'coit', x: 63.8, z: 31 });      // atop Telegraph Hill
  P.push({ kind: 'sutro', x: 30, z: 68 });
  P.push({ kind: 'paintedladies', x: 36, z: 54.7, rot: PI }); // facing Alamo Square
  P.push({ kind: 'ferry', x: 85.2, z: 44.2, rot: PI / 2 });   // facing the Embarcadero
  P.push({ kind: 'cablecar', x: 50.2, z: 45, rot: PI / 2 });  // Powell turnaround exhibit
  P.push({ kind: 'fountain', x: 52, z: 43.4 });
  P.push({ kind: 'board', x: 54.6, z: 42.6, rot: PI });
  P.push({ kind: 'mailbox', x: 49.4, z: 49.8 });
  P.push({ kind: 'shrine', x: 60.4, z: 30 });
  P.push({ kind: 'well', x: 61.8, z: 33.4 });
  P.push({ kind: 'forge', x: 42.5, z: 60.8 });
  P.push({ kind: 'anvil', x: 44, z: 62.2 });
  P.push({ kind: 'house', x: 40.6, z: 63.4, rot: 0.3 });
  P.push({ kind: 'flowerpatch', x: 23, z: 50.6 });
  P.push({ kind: 'boat', x: 82.5, z: 33.6, rot: 0.5 });
  P.push({ kind: 'boat', x: 87.5, z: 52.6, rot: -0.7 });
  P.push({ kind: 'irs', x: 16.5, z: 52, rot: -PI / 2 }); // west outskirts, on solid ground, door facing town
  P.push({ kind: 'rock', x: 40.8, z: 25.4, scale: 0.8 });
  P.push({ kind: 'rock', x: 12.4, z: 60.2, scale: 1.1 });

  // downtown filler towers (kept off the road bands and off Telegraph Hill)
  for (const [x, z] of [
    [69.8, 30.2], [73.5, 31.5], [70.5, 33.8], [73.5, 40.5],
    [60.5, 40.0], [70.5, 44.0], [74.0, 44.5], [64.8, 39.2],
  ] as const) P.push({ kind: 'tower', x, z });

  // market stalls + a couple of shops
  P.push({ kind: 'stall', x: 41, z: 40.6, rot: 0 });
  P.push({ kind: 'stall', x: 43.6, z: 40.8, rot: 0.15 });
  P.push({ kind: 'stall', x: 41.2, z: 43.6, rot: PI });

  // the farm
  P.push({ kind: 'pen', x: 20.5, z: 80.5 });
  P.push({ kind: 'fence', x: 24.5, z: 77.5 });
  P.push({ kind: 'fence', x: 26.5, z: 77.5 });
  P.push({ kind: 'fence', x: 25.5, z: 82.5, rot: PI / 2 });
  P.push({ kind: 'house', x: 24.5, z: 75.2, rot: PI });

  // ── trees: parks, marina green, Twin Peaks pines, Marin pines ──
  const treeAt = (x: number, z: number, pine = false) => {
    if (landAt(x, z) && tile(x, z) !== 'r') P.push({ kind: pine ? 'pine' : 'tree', x, z });
  };
  for (let i = 0; i < 14; i++) { // Golden Gate Park groves
    const x = 15 + hash01(i, 3) * 16, z = 49.5 + hash01(i, 7) * 5.4;
    if (Math.abs(z - 52) > 0.9) treeAt(x, z);
  }
  for (const [x, z] of [[33.2, 51.2], [39.0, 51.0], [36.5, 52.6]] as const) treeAt(x, z); // Alamo
  for (let i = 0; i < 6; i++) treeAt(20 + i * 5.2, 25.8 + hash01(i, 11) * 1.4); // Marina green
  for (let i = 0; i < 8; i++) treeAt(27 + hash01(i, 5) * 8, 64 + hash01(i, 9) * 9, true); // Twin Peaks
  for (let i = 0; i < 6; i++) treeAt(36 + hash01(i, 13) * 22, 1 + hash01(i, 17) * 5.5, true); // Marin

  // ── street lamps on intersection corners ──
  for (const a of AVENUES) {
    for (const s of STREETS) {
      if (hash01(a, s) > 0.55) continue;
      const x = a + 2.4, z = s + 2.4;
      if (landAt(x, z) && tile(x, z) !== 'r') P.push({ kind: 'lamp', x, z });
    }
  }
  P.push({ kind: 'lamp', x: 50.5, z: 42.3 });
  P.push({ kind: 'lamp', x: 54.5, z: 45.2 });

  // ── residential auto-fill: SF row houses along every ordinary block ──
  const reserved = [
    RECTS.ggpark, RECTS.alamo, RECTS.plaza, RECTS.market, RECTS.forgeBlk,
    RECTS.farm, RECTS.downtown, RECTS.peaks, RECTS.ferryPad,
    { x0: 43, x1: 51, z0: 25, z1: 29 }, // Crissy Field / bridge approach lawn
  ];
  const overlaps = (x0: number, x1: number, z0: number, z1: number) =>
    reserved.some((r) => x0 <= r.x1 && x1 >= r.x0 && z0 <= r.z1 && z1 >= r.z0);

  for (let ai = 0; ai < AVENUES.length - 1; ai++) {
    for (let si = 0; si < STREETS.length - 1; si++) {
      const bx0 = AVENUES[ai] + 2, bx1 = AVENUES[ai + 1] - 2;
      const bz0 = STREETS[si] + 2, bz1 = STREETS[si + 1] - 2;
      if (overlaps(bx0, bx1, bz0, bz1)) continue;
      // enough solid ground?
      let land = 0, total = 0;
      for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) { total++; if (landAt(x, z)) land++; }
      if (!total || land / total < 0.9) continue;

      for (const north of [true, false]) {
        const z = north ? bz0 + 0.95 : bz1 - 0.95;
        const rot = north ? PI : 0; // recipes face +z; π turns them to face the street
        for (let k = 0; k < 3; k++) {
          const x = bx0 + 1.05 + k * 2.15;
          if (!landAt(x, z)) continue;
          const r = hash01(Math.round(x * 7), Math.round(z * 13));
          if (r < 0.13) { treeAt(x, north ? z + 2.6 : z - 2.6); continue; } // garden gap
          P.push({ kind: r < 0.3 ? 'shop' : 'sfhouse', x, z, rot });
        }
      }
    }
  }

  return P;
}

const PROP_DEFS: PropDef[] = buildProps();

/** Height (in blocks) of the column under world position (x, z); water is 0. */
export function heightAt(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  if (xi < 0 || zi < 0 || xi >= SIZE || zi >= SIZE) return 0;
  return HEIGHTS[zi].charCodeAt(xi) - 48;
}

export function tileAt(x: number, z: number): string {
  const xi = Math.floor(x), zi = Math.floor(z);
  if (xi < 0 || zi < 0 || xi >= SIZE || zi >= SIZE) return '~';
  return TILES[zi][xi];
}

export function isLand(x: number, z: number): boolean {
  return tileAt(x, z) !== '~';
}

/** Street asphalt or the bridge deck — where carts drive and NPCs don't idle. */
export function isRoad(x: number, z: number): boolean {
  const t = tileAt(x, z);
  return t === 'r' || t === 'b';
}

/** Land, and — when a fromHeight is given — a step of at most one block. */
export function walkable(x: number, z: number, fromHeight?: number): boolean {
  if (!isLand(x, z)) return false;
  if (fromHeight !== undefined && Math.abs(heightAt(x, z) - fromHeight) > 1) return false;
  return true;
}

/**
 * Rough footprint radii for solid props — these become the island's `blockers`,
 * so walkability (players, NPCs, animals) collides with buildings instead of
 * ghosting through them. Walk-in or thin props (pen, fences, the Golden Gate
 * span, flower patch) are absent on purpose.
 */
const PROP_RADII: Partial<Record<PropKind, number>> = {
  fountain: 1.5,
  forge: 1.5,
  anvil: 0.6,
  house: 1.7,
  stall: 1.3,
  well: 1.0,
  shrine: 1.1,
  boat: 1.6,
  rock: 0.7,
  tree: 0.55,
  pine: 0.6,
  lamp: 0.4,
  board: 0.6,
  mailbox: 0.4,
  cablecar: 1.5,
  paintedladies: 1.9,
  transamerica: 1.6,
  salesforce: 1.6,
  coit: 1.3,
  sutro: 1.6,
  sfhouse: 1.2,
  irs: 4.2,
  shop: 1.3,
  tower: 1.7,
  ferry: 3.0,
};

const OBSTACLES = PROP_DEFS.flatMap((p) => {
  const r = PROP_RADII[p.kind];
  return r ? [{ x: p.x, z: p.z, r: r * (p.scale ?? 1) }] : [];
});

/**
 * Does moving (x1,z1)→(x2,z2) run into a solid prop? Entering a footprint is
 * blocked; a mover already inside one may step outward (self-rescue), never
 * deeper — so nobody can get permanently wedged in a wall.
 */
export function blockedMove(x1: number, z1: number, x2: number, z2: number): boolean {
  for (const o of OBSTACLES) {
    const dn = Math.hypot(x2 - o.x, z2 - o.z);
    if (dn >= o.r) continue;
    const dp = Math.hypot(x1 - o.x, z1 - o.z);
    if (dn < dp - 1e-6) return true; // inward is blocked; tangential/outward slides free
  }
  return false;
}

/** Can an entity standing at (x1,z1) take a step onto (x2,z2)? */
export function canStep(x1: number, z1: number, x2: number, z2: number): boolean {
  return walkable(x2, z2, heightAt(x1, z1)) && !blockedMove(x1, z1, x2, z2);
}

export const island: Island = {
  size: SIZE,
  tiles: TILES,
  heights: HEIGHTS,
  pois: POI_DEFS.map((p) => ({ id: p.id, label: p.label, pos: { x: p.x, y: heightAt(p.x, p.z), z: p.z } })),
  props: PROP_DEFS.map((p): Prop => ({
    kind: p.kind,
    pos: { x: p.x, y: heightAt(p.x, p.z), z: p.z },
    ...(p.rot !== undefined ? { rot: p.rot } : {}),
    ...(p.scale !== undefined ? { scale: p.scale } : {}),
  })),
  blockers: OBSTACLES,
};

export function poi(id: string): Island['pois'][number] | undefined {
  return island.pois.find((p) => p.id === id);
}

export const POI_IDS: string[] = island.pois.map((p) => p.id);
export const POI_LABELS: Record<string, string> = Object.fromEntries(POI_DEFS.map((p) => [p.id, p.label]));

/** The 'near' anchors accepted by POST /api/objects. */
export const NEAR_TARGETS = ['plaza', 'forge', 'market', 'farm', 'docks', 'hill'] as const;

/** True when (x, z) is outside every solid prop's footprint. */
export function isOpenSpot(x: number, z: number): boolean {
  for (const o of OBSTACLES) if (Math.hypot(x - o.x, z - o.z) < o.r) return false;
  return true;
}

/** A random open walkable point within radius of (x, z); falls back to the anchor itself. */
export function randomWalkableNear(x: number, z: number, radius = 2.5): Vec3 {
  for (let i = 0; i < 32; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.5 + Math.random() * radius;
    const nx = Math.round((x + Math.sin(a) * r) * 10) / 10;
    const nz = Math.round((z + Math.cos(a) * r) * 10) / 10;
    if (isLand(nx, nz) && isOpenSpot(nx, nz)) return { x: nx, y: heightAt(nx, nz), z: nz };
  }
  return { x, y: heightAt(x, z), z };
}

/** Where the player wakes up: on the plaza, a step south of the fountain. */
export const SPAWN: Vec3 = { x: 53.4, y: heightAt(53.4, 44.8), z: 44.8 };
