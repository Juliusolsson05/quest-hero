/**
 * The island of Ashford — 48×48 tiles, one voxel = 1m (SPEC §3).
 * Authored here as ASCII rows; the hub is the single source of layout and the
 * client meshes exactly what the welcome frame carries.
 *
 * Tiles:   ~ water   . grass   , dirt   : path   # plaza stone   s sand
 * Heights: '0'-'9' per column — water 0, beach/pier 1, land 2, hill 3-4.
 */
import type { Island, PropKind, Vec3 } from '../../shared/protocol';

export const SIZE = 48;

const TILES: string[] = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~ssssssss~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~sss...sssssssss~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~ss..........sssss~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~s...............ss~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~ss................ss~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~ss..................ss~~~~~~~~~~~',
  '~~~~~~~~~~~~~sss..............,,,,,ss~~~~~~~~~~~',
  '~~~~~~~~~~~ssss.......:.......,,,,,,ss~~~~~~~~~~',
  '~~~~~~~~~ssss.........:.......,,,,,,ss~~~~~~~~~~',
  '~~~~~~~~~ss...........:.......,,,,,,,ss~~~~~~~~~',
  '~~~~~~~~ss............:.......,,,,,,,,sss~~~~~~~',
  '~~~~~~~~ss.........::::.......,,,:,,,,.sss~~~~~~',
  '~~~~~~~~ss............:.......,,,:,,,,...ss~~~~~',
  '~~~~~~~~ss............:.......,,,:,,,,....ss~~~~',
  '~~~~~~~~ss............:..........:.........s~~~~',
  '~~~~~~~~ss............:...::::::::.........ss~~~',
  '~~~~~~~~ss............:...:................ss~~~',
  '~~~~~~~~ss............:...:................ss~~~',
  '~~~~~~~~s............######................s~~~~',
  '~~~~~~~ss............######................s~~~~',
  '~~~~~~~ss............######................s~~~~',
  '~~~~~~~ss......::::::######:::::::::.......s~~~~',
  '~~~~~~~ss............######........:.......s~~~~',
  '~~~~~~~ss............######........:.......s~~~~',
  '~~~~~~~ss...............:..................s~~~~',
  '~~~~~~~~s...............:.................ss~~~~',
  '~~~~~~~~s...............:.................ss~~~~',
  '~~~~~~~ss...............:................ss~~~~~',
  '~~~~~~~ss...............:...............ss~~~~~~',
  '~~~~~~~s................:..............ss~~~~~~~',
  '~~~~~~~s................:............sss~~~~~~~~',
  '~~~~~~~s...............s:s..........ss~~~~~~~~~~',
  '~~~~~~ss..............s::~s.........ss~~~~~~~~~~',
  '~~~~~~ss.............ss::~~s.......ss~~~~~~~~~~~',
  '~~~~~~~ss...........ss~::~~~s......s~~~~~~~~~~~~',
  '~~~~~~~sss.........ss~~::~~~~s....ss~~~~~~~~~~~~',
  '~~~~~~~~sssssssssss~~~~::~~~~~sssss~~~~~~~~~~~~~',
  '~~~~~~~~~~ssssss~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
];

const HEIGHTS: string[] = [
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000011111111000000000000000000000',
  '000000000000000000111222111111111000000000000000',
  '000000000000000001122222222221111100000000000000',
  '000000000000000001222333222222222110000000000000',
  '000000000000000011233333333322222211000000000000',
  '000000000000000112234444443322222221100000000000',
  '000000000000011122344444443322222221100000000000',
  '000000000001111223344444443322222222110000000000',
  '000000000111122223334444433322222222110000000000',
  '000000000112222223333444333322222222211000000000',
  '000000001122222222333333333222222222221110000000',
  '000000001122222222233333332222222222222111000000',
  '000000001122222222222222222222222222222221100000',
  '000000001122222222222222222222222222222222110000',
  '000000001122222222222222222222222222222222210000',
  '000000001122222222222222222222222222222222211000',
  '000000001122222222222222222222222222222222211000',
  '000000001122222222222222222222222222222222211000',
  '000000001222222222222222222222222222222222210000',
  '000000011222222222222222222222222222222222210000',
  '000000011222222222222222222222222222222222210000',
  '000000011222222222222222222222222222222222210000',
  '000000011222222222222222222222222222222222210000',
  '000000011222222222222222222222222222222222210000',
  '000000011222222222222222222222222222222222210000',
  '000000001222222222222222222222222222222222110000',
  '000000001222222222222222222222222222222222110000',
  '000000011222222222222222222222222222222221100000',
  '000000011222222222222222222222222222222211000000',
  '000000012222222222222222222222222222222110000000',
  '000000012222222222222222122222222222211100000000',
  '000000012222222222222221112222222222110000000000',
  '000000112222222222222211101222222222110000000000',
  '000000112222222222222111100122222221100000000000',
  '000000011222222222221101100012222221000000000000',
  '000000011122222222211001100001222211000000000000',
  '000000001111111111100001100000111110000000000000',
  '000000000011111100000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
];

const POI_DEFS: { id: string; label: string; x: number; z: number }[] = [
  { id: 'plaza', label: 'the plaza', x: 24, z: 24 },
  { id: 'forge', label: 'the forge', x: 14, z: 24 },
  { id: 'market', label: 'the market', x: 33, z: 24 },
  { id: 'farm', label: 'the farm', x: 33, z: 13 },
  { id: 'docks', label: 'the docks', x: 24, z: 33 },
  { id: 'hill', label: 'the shrine hill', x: 22, z: 9 },
  { id: 'board', label: 'the notice board', x: 27, z: 21 },
  { id: 'mailbox', label: 'the mailbox', x: 35, z: 26 },
  { id: 'pen', label: 'the chicken pen', x: 35, z: 11 },
  { id: 'flowerpatch', label: 'the flower patch', x: 19, z: 14 },
];

const PROP_DEFS: { kind: PropKind; x: number; z: number; rot?: number; scale?: number }[] = [
  { kind: 'tree', x: 9.4, z: 28.4 },
  { kind: 'tree', x: 13.4, z: 15.4 },
  { kind: 'tree', x: 28.4, z: 6.4 },
  { kind: 'tree', x: 40.4, z: 22.4 },
  { kind: 'tree', x: 38.4, z: 31.4 },
  { kind: 'tree', x: 13.4, z: 34.4 },
  { kind: 'tree', x: 19.4, z: 37.4 },
  { kind: 'tree', x: 31.4, z: 36.4 },
  { kind: 'tree', x: 10.4, z: 24.4 },
  { kind: 'tree', x: 16.4, z: 31.4 },
  { kind: 'pine', x: 20, z: 7 },
  { kind: 'pine', x: 25, z: 10 },
  { kind: 'lamp', x: 20, z: 20 },
  { kind: 'lamp', x: 27, z: 20 },
  { kind: 'lamp', x: 20, z: 27 },
  { kind: 'lamp', x: 27, z: 27 },
  { kind: 'fountain', x: 23.5, z: 23.5 },
  { kind: 'board', x: 27, z: 21, rot: 3.141592653589793 },
  { kind: 'forge', x: 13.5, z: 23 },
  { kind: 'anvil', x: 15, z: 25.2 },
  { kind: 'house', x: 12, z: 21 },
  { kind: 'house', x: 37, z: 22 },
  { kind: 'stall', x: 33, z: 23 },
  { kind: 'mailbox', x: 35.3, z: 26.4 },
  { kind: 'pen', x: 35, z: 11 },
  { kind: 'fence', x: 31, z: 9 },
  { kind: 'fence', x: 33, z: 9, rot: 1.5708 },
  { kind: 'fence', x: 30, z: 10 },
  { kind: 'fence', x: 30, z: 12, rot: 1.5708 },
  { kind: 'fence', x: 37, z: 13 },
  { kind: 'fence', x: 30, z: 14, rot: 1.5708 },
  { kind: 'boat', x: 26.3, z: 35.3, rot: 0.6 },
  { kind: 'rock', x: 22.3, z: 35.2, scale: 0.7 },
  { kind: 'rock', x: 21.3, z: 36.2, scale: 0.95 },
  { kind: 'rock', x: 22.3, z: 36.2, scale: 1.2 },
  { kind: 'flowerpatch', x: 18.4, z: 13.5 },
  { kind: 'shrine', x: 21, z: 8 },
  { kind: 'well', x: 24, z: 9 },
];

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

/** Land, and — when a fromHeight is given — a step of at most one block. */
export function walkable(x: number, z: number, fromHeight?: number): boolean {
  if (!isLand(x, z)) return false;
  if (fromHeight !== undefined && Math.abs(heightAt(x, z) - fromHeight) > 1) return false;
  return true;
}

/** Can an entity standing at (x1,z1) take a step onto (x2,z2)? */
export function canStep(x1: number, z1: number, x2: number, z2: number): boolean {
  return walkable(x2, z2, heightAt(x1, z1));
}

export const island: Island = {
  size: SIZE,
  tiles: TILES,
  heights: HEIGHTS,
  pois: POI_DEFS.map((p) => ({ id: p.id, label: p.label, pos: { x: p.x, y: heightAt(p.x, p.z), z: p.z } })),
  props: PROP_DEFS.map((p) => ({
    kind: p.kind,
    pos: { x: p.x, y: heightAt(p.x, p.z), z: p.z },
    ...(p.rot !== undefined ? { rot: p.rot } : {}),
    ...(p.scale !== undefined ? { scale: p.scale } : {}),
  })),
};

export function poi(id: string): Island['pois'][number] | undefined {
  return island.pois.find((p) => p.id === id);
}

export const POI_IDS: string[] = island.pois.map((p) => p.id);
export const POI_LABELS: Record<string, string> = Object.fromEntries(POI_DEFS.map((p) => [p.id, p.label]));

/** The 'near' anchors accepted by POST /api/objects. */
export const NEAR_TARGETS = ['plaza', 'forge', 'market', 'farm', 'docks', 'hill'] as const;

/** A random walkable point within radius of (x, z); falls back to the anchor itself. */
export function randomWalkableNear(x: number, z: number, radius = 2.5): Vec3 {
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.5 + Math.random() * radius;
    const nx = Math.round((x + Math.sin(a) * r) * 10) / 10;
    const nz = Math.round((z + Math.cos(a) * r) * 10) / 10;
    if (isLand(nx, nz)) return { x: nx, y: heightAt(nx, nz), z: nz };
  }
  return { x, y: heightAt(x, z), z };
}

/** Where the player wakes up: on the docks path, a few steps up from the pier. */
export const SPAWN: Vec3 = { x: 24, y: heightAt(24, 30), z: 30 };
