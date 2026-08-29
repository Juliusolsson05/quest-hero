import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Island, ObjectKind, Prop } from '../../shared/protocol';

/**
 * Voxel renderer for the island the hub describes. Terrain is a handful of
 * InstancedMeshes (one per tile material); static props are box-lists merged
 * into one mesh per colour — the whole village lands in well under 40 draw
 * calls, which is what buys us shadows + bloom at 60fps.
 */

// ── palette ────────────────────────────────────────────────────────────────
export const C = {
  grass: 0x8fd483, grassB: 0x7cc474, dirt: 0xc9a26b, path: 0xdcbb85,
  plaza: 0xcdd3d8, sand: 0xf2e3b3, water: 0x7fd1e8, under: 0xa9825b,
  trunk: 0x9a6b45, leaf: 0x86d69a, leafB: 0x6cc588, pine: 0x5cae7e,
  stone: 0xb9bfc7, stoneD: 0x9aa1ab, wood: 0xb98a5a, woodD: 0x8f6a44,
  cream: 0xfff3dd, coral: 0xff9d96, peach: 0xffd3b6, sky: 0xb5e2fa,
  pink: 0xffb7d5, yellow: 0xffe08a, white: 0xffffff, dark: 0x4a4a55,
  ember: 0xff7b3a, gold: 0xffd977,
  // Little San Francisco
  ggOrange: 0xe25b3d, concrete: 0xe8e0cf, concreteD: 0xdfd7c2,
  glass: 0xa8cfe0, glassL: 0xd8ecf5, mint: 0xaee3c8, lav: 0xcdb8f0,
  maroon: 0x8f3b3b, tam: 0xf7f3e8, tamB: 0xefe9db,
};

/** Box with per-face vertex shading baked in: bright top, dimmer sides,
 *  darkest bottom. Multiplied with material/instance colour, it gives the
 *  clean "voxel" read without any lighting tricks. */
function shadedBox(w = 1, h = 1, d = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const n = g.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i), nx = n.getX(i);
    const v = ny > 0.5 ? 1.0 : ny < -0.5 ? 0.55 : Math.abs(nx) > 0.5 ? 0.78 : 0.9;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

const UNIT = shadedBox();

// ── island queries (client mirror of the hub's walkability) ────────────────
export class IslandView {
  constructor(readonly island: Island) {}

  heightAt(x: number, z: number): number {
    const i = Math.floor(x), j = Math.floor(z);
    const row = this.island.heights[j];
    if (!row || i < 0 || i >= row.length) return 0;
    return row.charCodeAt(i) - 48;
  }
  tileAt(x: number, z: number): string {
    return this.island.tiles[Math.floor(z)]?.[Math.floor(x)] ?? '~';
  }
  walkable(x: number, z: number, fromH: number): boolean {
    const h = this.heightAt(x, z);
    return this.tileAt(x, z) !== '~' && h >= 1 && h - fromH <= 1;
  }
  poi(id: string) { return this.island.pois.find((p) => p.id === id); }
}

// ── terrain ────────────────────────────────────────────────────────────────
export interface BuiltWorld {
  group: THREE.Group;
  lamps: THREE.Vector3[];
  glows: { pos: THREE.Vector3; color: number; strength: number }[];
  smoke: THREE.Vector3[];
  fountains: THREE.Vector3[];
  water: THREE.InstancedMesh | null;
}

export function buildIsland(island: Island): BuiltWorld {
  const group = new THREE.Group();
  const view = new IslandView(island);
  const size = island.size;

  // Count instances per material first, then fill.
  type Bucket = { color: number; jitter: number; cells: [number, number, number][] };
  const buckets: Record<string, Bucket> = {
    grass: { color: C.grass, jitter: 0.055, cells: [] },
    path: { color: C.path, jitter: 0.03, cells: [] },
    plaza: { color: C.plaza, jitter: 0.03, cells: [] },
    sand: { color: C.sand, jitter: 0.035, cells: [] },
    dirt: { color: C.dirt, jitter: 0.04, cells: [] },
    under: { color: C.under, jitter: 0.04, cells: [] },
  };
  const waterCells: [number, number][] = [];

  const topBucket = (t: string): Bucket => (
    t === ':' ? buckets.path : t === '#' ? buckets.plaza :
    t === 's' ? buckets.sand : t === ',' ? buckets.dirt : buckets.grass
  );

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const t = view.tileAt(x, z);
      if (t === '~') { waterCells.push([x, z]); continue; }
      const h = view.heightAt(x, z);
      if (h < 1) { waterCells.push([x, z]); continue; }
      topBucket(t).cells.push([x, h - 1, z]);
      // Fill below only where a neighbour is lower (exposed cliff face).
      const minN = Math.min(
        view.heightAt(x - 1, z), view.heightAt(x + 1, z),
        view.heightAt(x, z - 1), view.heightAt(x, z + 1),
      );
      for (let y = Math.max(0, minN); y < h - 1; y++) buckets.under.cells.push([x, y, z]);
    }
  }

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (const b of Object.values(buckets)) {
    if (!b.cells.length) continue;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const mesh = new THREE.InstancedMesh(UNIT, mat, b.cells.length);
    b.cells.forEach(([x, y, z], i) => {
      dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const j = 1 - b.jitter + Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * b.jitter * 2;
      mesh.setColorAt(i, col.setHex(b.color).multiplyScalar(j));
    });
    mesh.receiveShadow = true;
    mesh.castShadow = b === buckets.under; // cliff faces cast, tops just receive
    group.add(mesh);
  }

  // Water: translucent cubes a touch below land level, animated in fx.ts.
  let water: THREE.InstancedMesh | null = null;
  if (waterCells.length) {
    const wmat = new THREE.MeshStandardMaterial({
      color: C.water, transparent: true, opacity: 0.82, roughness: 0.35,
      vertexColors: true,
    });
    water = new THREE.InstancedMesh(UNIT, wmat, waterCells.length);
    waterCells.forEach(([x, z], i) => {
      dummy.position.set(x + 0.5, 0.42, z + 0.5);
      dummy.scale.set(1, 0.84, 1);
      dummy.updateMatrix();
      water!.setMatrixAt(i, dummy.matrix);
    });
    dummy.scale.set(1, 1, 1);
    group.add(water);
    // A dark seabed plane so depth reads under the translucent water.
    const bed = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 3, size * 3),
      new THREE.MeshStandardMaterial({ color: 0x2e6f86, roughness: 1 }),
    );
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(size / 2, -0.15, size / 2);
    group.add(bed);
  }

  // ── props ──
  const built = buildProps(island.props, view);
  group.add(built.mesh);
  for (const m of built.extras) group.add(m);

  return { group, lamps: built.lamps, glows: built.glows, smoke: built.smoke,
           fountains: built.fountains, water };
}

// ── prop construction: little box recipes, merged per colour ───────────────
interface Box { x: number; y: number; z: number; w: number; h: number; d: number;
                color: number; rot?: number }

function buildProps(props: Prop[], view: IslandView) {
  const boxes: Box[] = [];
  const lamps: THREE.Vector3[] = [];
  const glows: BuiltWorld['glows'] = [];
  const smoke: THREE.Vector3[] = [];
  const fountains: THREE.Vector3[] = [];
  const extras: THREE.Mesh[] = [];

  const add = (b: Box) => boxes.push(b);

  for (const p of props) {
    const gy = p.pos.y || view.heightAt(p.pos.x, p.pos.z);
    const x = p.pos.x, z = p.pos.z, r = p.rot ?? 0, s = p.scale ?? 1;
    const B = (dx: number, dy: number, dz: number, w: number, h: number, d: number, color: number) => {
      // rotate offset around prop origin so `rot` turns the whole recipe
      const cx = dx * Math.cos(r) - dz * Math.sin(r);
      const cz = dx * Math.sin(r) + dz * Math.cos(r);
      add({ x: x + cx * s, y: gy + dy * s, z: z + cz * s, w: w * s, h: h * s, d: d * s, color, rot: r });
    };

    switch (p.kind) {
      case 'tree':
        B(0, 0.6, 0, 0.42, 1.2, 0.42, C.trunk);
        B(0, 1.7, 0, 1.7, 1.0, 1.7, C.leaf);
        B(0.12, 2.5, -0.08, 1.15, 0.75, 1.15, C.leafB);
        B(-0.06, 3.05, 0.06, 0.6, 0.5, 0.6, C.leaf);
        break;
      case 'pine':
        B(0, 0.5, 0, 0.36, 1.0, 0.36, C.trunk);
        B(0, 1.35, 0, 1.5, 0.7, 1.5, C.pine);
        B(0, 2.0, 0, 1.05, 0.65, 1.05, C.pine);
        B(0, 2.6, 0, 0.6, 0.6, 0.6, C.leafB);
        break;
      case 'lamp':
        B(0, 0.9, 0, 0.14, 1.8, 0.14, C.dark);
        B(0, 1.9, 0, 0.4, 0.36, 0.4, C.dark);
        lamps.push(new THREE.Vector3(x, gy + 1.9, z));
        break;
      case 'fence':
        B(-0.45, 0.35, 0, 0.12, 0.7, 0.12, C.woodD);
        B(0.45, 0.35, 0, 0.12, 0.7, 0.12, C.woodD);
        B(0, 0.52, 0, 1.05, 0.12, 0.09, C.wood);
        B(0, 0.26, 0, 1.05, 0.12, 0.09, C.wood);
        break;
      case 'pen': { // 3.5m fenced square with a gap for the gate
        const seg = [-1.6, -0.53, 0.53, 1.6];
        for (const o of seg) {
          B(o, 0.4, -1.6, 1.0, 0.5, 0.1, C.wood); // north rail
          B(o, 0.4, 1.6, 1.0, 0.5, 0.1, C.wood);  // south
          B(-1.6, 0.4, o, 0.1, 0.5, 1.0, C.wood); // west
          if (o < 1) B(1.6, 0.4, o, 0.1, 0.5, 1.0, C.wood); // east, gap = gate
        }
        for (const [px, pz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const)
          B(px, 0.45, pz, 0.16, 0.9, 0.16, C.woodD);
        break;
      }
      case 'stall':
        B(0, 0.5, 0, 2.0, 1.0, 1.1, C.wood);              // counter
        B(-0.9, 1.1, -0.5, 0.12, 2.2, 0.12, C.woodD);     // posts
        B(0.9, 1.1, -0.5, 0.12, 2.2, 0.12, C.woodD);
        B(-0.9, 1.1, 0.5, 0.12, 2.2, 0.12, C.woodD);
        B(0.9, 1.1, 0.5, 0.12, 2.2, 0.12, C.woodD);
        for (let i = 0; i < 5; i++)                        // striped awning
          B(-1.0 + i * 0.5, 2.3, 0, 0.5, 0.14, 1.6, i % 2 ? C.cream : C.coral);
        B(-0.5, 1.15, 0, 0.4, 0.3, 0.4, C.peach);          // wares
        B(0.3, 1.12, 0.15, 0.35, 0.24, 0.35, C.sky);
        break;
      case 'fountain':
        for (const [dx, dz, w, d] of [[0, -0.95, 2.1, 0.25], [0, 0.95, 2.1, 0.25],
                                      [-0.95, 0, 0.25, 1.7], [0.95, 0, 0.25, 1.7]] as const)
          B(dx, 0.3, dz, w, 0.6, d, C.stone);
        B(0, 0.15, 0, 1.7, 0.3, 1.7, C.sky);               // pool water
        B(0, 0.75, 0, 0.4, 1.2, 0.4, C.stoneD);            // pillar
        B(0, 1.4, 0, 0.7, 0.15, 0.7, C.stone);
        fountains.push(new THREE.Vector3(x, gy + 1.5, z));
        break;
      case 'board':
        B(-0.6, 0.9, 0, 0.14, 1.8, 0.14, C.woodD);
        B(0.6, 0.9, 0, 0.14, 1.8, 0.14, C.woodD);
        B(0, 1.25, 0, 1.5, 1.0, 0.12, C.wood);
        B(0, 1.95, 0, 1.7, 0.18, 0.2, C.woodD);
        B(-0.35, 1.3, 0.08, 0.42, 0.5, 0.03, C.cream);     // pinned notes
        B(0.25, 1.2, 0.08, 0.36, 0.44, 0.03, C.cream);
        break;
      case 'forge':
        B(0, 0.55, 0, 2.4, 1.1, 1.5, 0x6b6470);            // stone hearth
        B(0.7, 1.8, -0.3, 0.5, 1.6, 0.5, 0x565060);        // chimney
        B(-0.3, 1.12, 0, 0.9, 0.18, 0.9, C.ember);         // embers
        glows.push({ pos: new THREE.Vector3(x - 0.3, gy + 1.35, z), color: C.ember, strength: 9 });
        smoke.push(new THREE.Vector3(x + 0.7, gy + 2.7, z - 0.3));
        break;
      case 'anvil':
        B(0, 0.25, 0, 0.5, 0.5, 0.5, 0x565060);
        B(0, 0.62, 0, 1.0, 0.26, 0.42, 0x6b6470);
        break;
      case 'house': {
        const wall = Math.abs(Math.sin(x * 7 + z)) > 0.5 ? C.cream : C.peach;
        B(0, 1.0, 0, 3.0, 2.0, 2.6, wall);
        B(0, 2.25, 0, 3.4, 0.5, 3.0, C.coral);             // roof slabs
        B(0, 2.7, 0, 2.4, 0.45, 2.1, C.coral);
        B(0, 3.05, 0, 1.3, 0.3, 1.1, 0xe98b84);
        B(0, 0.8, 1.31, 0.7, 1.5, 0.08, C.woodD);          // door
        B(-0.95, 1.25, 1.31, 0.6, 0.6, 0.06, C.sky);       // windows
        B(0.95, 1.25, 1.31, 0.6, 0.6, 0.06, C.sky);
        B(0.9, 3.0, -0.6, 0.35, 1.0, 0.35, 0x8d8794);      // chimney
        smoke.push(new THREE.Vector3(x + 0.9 * Math.cos(r), gy + 3.6, z + 0.9 * Math.sin(r) - 0.6));
        break;
      }
      case 'mailbox':
        B(0, 0.5, 0, 0.12, 1.0, 0.12, C.woodD);
        B(0, 1.1, 0, 0.55, 0.4, 0.38, C.coral);
        B(0.2, 1.35, 0, 0.06, 0.3, 0.06, C.cream);
        break;
      case 'boat':
        B(0, 0.3, 0, 2.4, 0.5, 1.1, C.wood);
        B(0, 0.42, 0, 1.8, 0.3, 0.7, 0x8a6a4d);
        B(0, 0.62, -0.15, 1.6, 0.1, 0.25, C.woodD);
        break;
      case 'rock':
        B(0, 0.3, 0, 0.9, 0.6, 0.7, C.stoneD);
        B(0.35, 0.55, 0.2, 0.45, 0.4, 0.4, C.stone);
        break;
      case 'flowerpatch':
        for (let i = 0; i < 9; i++) {
          const a = i * 2.39996, rad = 0.25 + (i % 3) * 0.38;
          const fx2 = Math.cos(a) * rad, fz = Math.sin(a) * rad;
          B(fx2, 0.14, fz, 0.08, 0.28, 0.08, 0x5faf6a);
          B(fx2, 0.33, fz, 0.2, 0.16, 0.2, [C.pink, C.yellow, C.white][i % 3]);
        }
        break;
      case 'shrine':
        B(0, 0.15, 0, 1.8, 0.3, 1.4, C.stone);
        B(-0.6, 0.85, 0, 0.22, 1.1, 0.22, 0xc9536b);
        B(0.6, 0.85, 0, 0.22, 1.1, 0.22, 0xc9536b);
        B(0, 1.5, 0, 1.9, 0.2, 0.6, 0xc9536b);
        B(0, 1.72, 0, 1.5, 0.16, 0.5, 0xb04258);
        B(0, 0.55, 0, 0.4, 0.5, 0.4, C.gold);
        break;
      case 'well':
        B(0, 0.35, 0, 1.2, 0.7, 1.2, C.stoneD);
        B(0, 0.4, 0, 0.8, 0.75, 0.8, 0x3e7d94);
        B(-0.5, 1.0, 0, 0.12, 1.4, 0.12, C.woodD);
        B(0.5, 1.0, 0, 0.12, 1.4, 0.12, C.woodD);
        B(0, 1.75, 0, 1.5, 0.16, 0.9, C.coral);
        break;

      // ── Little San Francisco ──
      case 'goldengate': {
        // Spans the south channel: towers straddle the existing causeway, so
        // the player walks the deck for free. Everything International Orange.
        const O = C.ggOrange, legX = 1.7, towZ = 2.2;
        for (const tz of [-towZ, towZ]) {
          B(-legX, 3.4, tz, 0.55, 9.8, 0.55, O);           // tower legs
          B(legX, 3.4, tz, 0.55, 9.8, 0.55, O);
          B(0, 3.0, tz, 3.4, 0.45, 0.4, O);                // portal braces
          B(0, 5.4, tz, 3.4, 0.42, 0.38, O);
          B(0, 7.3, tz, 3.4, 0.4, 0.36, O);
          B(0, 8.5, tz, 4.0, 0.5, 0.62, O);                // tower cap
          B(0, 8.95, tz, 0.14, 0.4, 0.14, 0xe8443a);       // beacon
        }
        const cableY = (dz: number) => {
          const a = Math.abs(dz);
          return a >= towZ ? 8.2 - ((a - towZ) / 2.6) * 7.0
                           : 3.1 + 5.1 * (dz / towZ) * (dz / towZ);
        };
        for (const sx of [-1, 1]) {
          for (let dz = -4.8; dz <= 4.81; dz += 0.6)       // stepped main cables
            B(sx * legX, cableY(dz), dz, 0.16, 0.16, 0.72, O);
          for (const dz of [-3.6, -2.9, -1.5, -0.75, 0, 0.75, 1.5, 2.9, 3.6]) {
            const cy = cableY(dz);                          // suspenders
            if (cy > 1.4) B(sx * legX, (cy + 0.8) / 2, dz, 0.07, cy - 0.8, 0.07, O);
          }
          B(sx * legX, 0.1, -4.9, 0.8, 2.6, 0.9, C.stoneD); // anchorages
          B(sx * legX, 0.1, 4.9, 0.8, 2.6, 0.9, C.stoneD);
          B(sx * 1.45, 0.62, 0, 0.1, 0.45, 6.8, O);         // deck railings
        }
        break;
      }
      case 'transamerica': {
        for (let i = 0; i < 8; i++) {                       // stepped pyramid
          const w = 2.8 - i * 0.33;
          B(0, 0.7 + i * 1.35, 0, w, 1.4, w, i % 2 ? C.tam : C.tamB);
        }
        B(-0.75, 8.2, 0, 0.3, 3.4, 0.6, C.tam);             // the wings
        B(0.75, 8.2, 0, 0.3, 3.4, 0.6, C.tam);
        B(0, 11.4, 0, 0.22, 1.6, 0.22, C.concreteD);        // spire
        B(0, 12.3, 0, 0.14, 0.3, 0.14, C.gold);             // beacon
        break;
      }
      case 'salesforce': {
        for (let i = 0; i < 8; i++) {                       // glass barrel
          B(0, 0.8 + i * 1.5, 0, 2.5, 1.5, 2.5, C.glass);
          B(0, 1.45 + i * 1.5, 0, 2.62, 0.14, 2.62, C.glassL); // fin bands
        }
        B(0, 12.55, 0, 2.1, 0.9, 2.1, C.glass);             // rounding top
        B(0, 13.25, 0, 1.5, 0.6, 1.5, C.glassL);
        B(0, 13.7, 0, 0.9, 0.4, 0.9, 0xf2f7ff);             // crown display
        glows.push({ pos: new THREE.Vector3(x, gy + 13.7, z), color: 0xcfe8ff, strength: 5 });
        break;
      }
      case 'paintedladies': {
        const row: [number, number][] = [
          [C.mint, 0xfdf6e3], [C.sky, 0xfdf6e3], [C.pink, 0xfdf6e3],
          [C.yellow, 0xfdf6e3], [C.lav, 0xfdf6e3],
        ];
        for (let i = 0; i < 5; i++) {                       // postcard row
          const ox = (i - 2) * 2.0;
          const [wall, trim] = row[i];
          B(ox, 1.15, 0, 1.9, 2.3, 1.8, wall);              // body
          B(ox, 2.4, 0, 1.95, 0.28, 1.85, trim);            // cornice
          B(ox, 2.75, 0, 1.5, 0.5, 1.6, wall);              // stepped gable
          B(ox, 3.12, 0, 0.95, 0.32, 1.4, trim);
          B(ox, 3.36, 0, 0.5, 0.22, 1.2, wall);
          B(ox + 0.42, 1.2, 0.98, 0.75, 1.6, 0.35, trim);   // bay window
          B(ox + 0.42, 1.25, 1.17, 0.5, 0.6, 0.06, C.sky);
          B(ox + 0.42, 2.0, 1.17, 0.5, 0.35, 0.06, C.sky);
          B(ox - 0.5, 0.85, 0.92, 0.55, 1.2, 0.1, C.woodD); // door
          B(ox - 0.5, 0.18, 1.12, 0.65, 0.36, 0.5, C.stoneD); // stoop
          B(ox, 2.98, 0.83, 0.28, 0.3, 0.06, C.sky);        // attic window
        }
        break;
      }
      case 'coit': {
        B(0, 0.35, 0, 2.0, 0.7, 2.0, C.stone);              // Telegraph Hill plinth
        B(0, 3.6, 0, 1.15, 5.8, 1.15, C.concrete);          // fluted shaft:
        add({ x, y: gy + 3.6, z, w: 1.15, h: 5.8, d: 1.15,  // two boxes, 45° apart
              color: C.concrete, rot: r + Math.PI / 4 });
        B(0, 6.7, 0, 1.45, 0.5, 1.45, C.concrete);          // arcade ring
        add({ x, y: gy + 6.7, z, w: 1.45, h: 0.5, d: 1.45,
              color: C.concreteD, rot: r + Math.PI / 4 });
        B(0, 7.1, 0, 1.0, 0.4, 1.0, C.concreteD);           // crown
        break;
      }
      case 'sutro': {
        const legs: [number, number][] = [[-0.85, -0.5], [0.85, -0.5], [0, 0.85]];
        for (const [lx, lz] of legs) {
          B(lx, 2.2, lz, 0.3, 4.4, 0.3, 0xf2f4f6);          // lower legs, white
          B(lx, 1.1, lz, 0.34, 0.9, 0.34, C.ggOrange);      // orange socks
          B(lx * 0.55, 6.2, lz * 0.55, 0.26, 3.6, 0.26, C.ggOrange); // upper legs
        }
        B(0, 4.6, 0, 2.3, 0.35, 2.0, C.ggOrange);           // waist platform
        B(0, 8.1, 0, 1.6, 0.3, 1.5, 0xf2f4f6);              // top platform
        for (const [lx, lz] of legs)
          B(lx * 0.42, 9.6, lz * 0.42, 0.16, 2.8, 0.16, 0xf2f4f6); // antennas
        B(0, 10.4, 0, 1.9, 0.12, 0.12, C.ggOrange);         // cross arm
        break;
      }
      case 'cablecar': {
        B(0, 0.05, -0.42, 3.2, 0.1, 0.12, 0x6b6470);        // rails
        B(0, 0.05, 0.42, 3.2, 0.1, 0.12, 0x6b6470);
        B(-0.6, 0.16, 0, 0.28, 0.22, 1.06, 0x3a3a42);       // wheel trucks
        B(0.6, 0.16, 0, 0.28, 0.22, 1.06, 0x3a3a42);
        B(0, 0.5, 0, 2.4, 0.55, 1.0, C.maroon);             // chassis
        B(0, 1.0, 0, 1.5, 0.55, 1.02, 0xf5e9d0);            // cream cabin band
        B(-0.35, 1.05, 0, 0.45, 0.35, 1.06, C.sky);         // windows
        B(0.35, 1.05, 0, 0.45, 0.35, 1.06, C.sky);
        B(-1.05, 0.95, 0, 0.3, 0.85, 1.02, C.maroon);       // end posts
        B(1.05, 0.95, 0, 0.3, 0.85, 1.02, C.maroon);
        B(0, 1.38, 0, 2.6, 0.16, 1.15, 0x6e4a35);           // roof
        B(0, 1.5, 0, 1.2, 0.12, 0.7, C.maroon);             // roof monitor
        B(0, 0.62, 0.52, 2.42, 0.1, 0.04, C.gold);          // gold beltline
        B(0, 0.62, -0.52, 2.42, 0.1, 0.04, C.gold);
        break;
      }
    }
  }

  return { mesh: mergeBoxes(boxes), lamps, glows, smoke, fountains, extras };
}

/** Merge a box list into one mesh per colour. */
function mergeBoxes(boxes: Box[]): THREE.Group {
  const byColor = new Map<number, Box[]>();
  for (const b of boxes) {
    const list = byColor.get(b.color) ?? [];
    list.push(b);
    byColor.set(b.color, list);
  }
  const group = new THREE.Group();
  for (const [color, list] of byColor) {
    const geos = list.map((b) => {
      const g = shadedBox(b.w, b.h, b.d);
      if (b.rot) g.rotateY(-b.rot);
      g.translate(b.x, b.y, b.z);
      return g;
    });
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
      color, vertexColors: true, roughness: 0.9,
      transparent: color === C.sky, opacity: color === C.sky ? 0.85 : 1,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// ── dynamic objects (spawned via MCP / commits / quests) ───────────────────
export function objectMesh(kind: ObjectKind): THREE.Group {
  const g = new THREE.Group();
  const M = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(shadedBox(w, h, d), new THREE.MeshStandardMaterial({
      color, vertexColors: true, roughness: 0.85,
    }));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (kind) {
    case 'crate':
      M(0.8, 0.8, 0.8, C.wood, 0, 0.4);
      M(0.86, 0.12, 0.86, C.woodD, 0, 0.76);
      M(0.86, 0.12, 0.86, C.woodD, 0, 0.06);
      break;
    case 'barrel':
      M(0.7, 0.9, 0.7, C.woodD, 0, 0.45);
      M(0.78, 0.12, 0.78, C.dark, 0, 0.2);
      M(0.78, 0.12, 0.78, C.dark, 0, 0.7);
      break;
    case 'flower':
      M(0.3, 0.25, 0.3, 0xb06a4a, 0, 0.12);
      M(0.1, 0.3, 0.1, 0x5faf6a, 0, 0.4);
      M(0.28, 0.22, 0.28, C.pink, 0, 0.6);
      break;
    case 'pumpkin':
      M(0.7, 0.55, 0.7, 0xf49b3d, 0, 0.28);
      M(0.12, 0.2, 0.12, 0x5faf6a, 0, 0.65);
      break;
    case 'gift':
      M(0.6, 0.5, 0.6, C.coral, 0, 0.25);
      M(0.66, 0.12, 0.14, C.cream, 0, 0.25);
      M(0.14, 0.12, 0.66, C.cream, 0, 0.25);
      M(0.2, 0.16, 0.2, C.cream, 0, 0.56);
      break;
    case 'torch': {
      M(0.1, 1.1, 0.1, C.woodD, 0, 0.55);
      const flame = M(0.24, 0.3, 0.24, C.ember, 0, 1.2);
      (flame.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(C.ember);
      (flame.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6;
      const light = new THREE.PointLight(C.ember, 6, 7, 2);
      light.position.set(0, 1.3, 0);
      g.add(light);
      break;
    }
    case 'snowman':
      M(0.75, 0.7, 0.75, C.white, 0, 0.35);
      M(0.55, 0.5, 0.55, C.white, 0, 0.9);
      M(0.4, 0.4, 0.4, C.white, 0, 1.35);
      M(0.08, 0.08, 0.3, 0xf49b3d, 0, 1.35, 0.3);
      break;
  }
  return g;
}
