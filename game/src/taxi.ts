import * as THREE from 'three';
import type { IslandView } from './world';
import type { Player } from './player';
import { propTemplate } from './props3d';

/**
 * The Cartly fleet. A summoned cart spawns at the Marin vista point, rolls
 * south over the Golden Gate, then drives the actual street grid — BFS over
 * the island's asphalt ('r') and bridge-deck ('b') tiles — to the curb nearest
 * the player. Rides drive the streets too. Pure client-side theatre: the hub
 * never hears about it, so it can't break anyone else's demo.
 */

export type CartKind = 'taxi' | 'waymo' | 'waymo-xl';

export const CARTS: Record<CartKind, {
  file: string; label: string; length: number; fare: number;
  driver: string; sub: string; plate: string; rating: string;
}> = {
  'taxi': {
    file: 'yellow-taxi.glb', label: 'yellow taxi', length: 2.6, fare: 8,
    driver: 'Gideon the Carter', sub: 'traded Buttercup for 200 horses', plate: 'ASH·42', rating: '4.9',
  },
  'waymo': {
    file: 'waymo-robotaxi.glb', label: 'waymo cart', length: 2.7, fare: 11,
    driver: 'nobody at all', sub: 'the cart drives itself ✨', plate: 'SF·001', rating: '4.99',
  },
  'waymo-xl': {
    file: 'waymo-minivan.glb', label: 'waymo XL', length: 3.1, fare: 14,
    driver: 'nobody at all', sub: 'six seats, zero drivers', plate: 'SF·XL7', rating: '4.98',
  },
};

const SPEED = 5.5; // m/s — quick enough for a demo, slow enough to savour the bridge

/** BFS routing over the drivable tiles of the island. */
class StreetAtlas {
  private readonly size: number;
  private readonly drivable: Uint8Array;
  /** The Marin vista point — the northernmost road tile, past the bridge. */
  readonly depot: [number, number];

  constructor(view: IslandView) {
    const size = view.island.size;
    this.size = size;
    this.drivable = new Uint8Array(size * size);
    let depot: [number, number] | null = null;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const t = view.tileAt(x, z);
        if (t === 'r' || t === 'b') {
          this.drivable[z * size + x] = 1;
          if (!depot) depot = [x, z]; // row-major scan → northernmost first
        }
      }
    }
    this.depot = depot ?? [0, 0];
  }

  /** The drivable tile whose centre is closest to (x, z) — the curb. */
  curb(x: number, z: number): [number, number] {
    let best: [number, number] = this.depot;
    let bestD = Infinity;
    for (let tz = 0; tz < this.size; tz++) {
      for (let tx = 0; tx < this.size; tx++) {
        if (!this.drivable[tz * this.size + tx]) continue;
        const d = (tx + 0.5 - x) ** 2 + (tz + 0.5 - z) ** 2;
        if (d < bestD) { bestD = d; best = [tx, tz]; }
      }
    }
    return best;
  }

  /**
   * Street waypoints (tile centres, corners only) from tile `from` to tile
   * `to`, or null when no street connects them.
   */
  route(from: [number, number], to: [number, number]): THREE.Vector3[] | null {
    const size = this.size;
    const start = from[1] * size + from[0];
    const goal = to[1] * size + to[0];
    if (!this.drivable[start] || !this.drivable[goal]) return null;
    const prev = new Int32Array(size * size).fill(-1);
    prev[start] = start;
    const q = [start];
    for (let qi = 0; qi < q.length && prev[goal] === -1; qi++) {
      const cur = q[qi];
      const cx = cur % size;
      for (const n of [cur - 1, cur + 1, cur - size, cur + size]) {
        if (n < 0 || n >= size * size || Math.abs((n % size) - cx) > 1) continue;
        if (!this.drivable[n] || prev[n] !== -1) continue;
        prev[n] = cur;
        q.push(n);
      }
    }
    if (prev[goal] === -1) return null;
    const cells: [number, number][] = [];
    for (let cur = goal; ; cur = prev[cur]) {
      cells.push([cur % size, Math.floor(cur / size)]);
      if (prev[cur] === cur) break;
    }
    cells.reverse();
    const wp: THREE.Vector3[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (i > 0 && i < cells.length - 1) { // keep corners, drop straightaways
        const [ax, az] = cells[i - 1], [bx, bz] = cells[i], [cx, cz] = cells[i + 1];
        if (bx - ax === cx - bx && bz - az === cz - bz) continue;
      }
      wp.push(new THREE.Vector3(cells[i][0] + 0.5, 0, cells[i][1] + 0.5));
    }
    return wp;
  }
}

type Phase = 'off' | 'arriving' | 'waiting' | 'riding' | 'leaving';

export class CartService {
  private mesh: THREE.Group | null = null;
  private kind: CartKind = 'taxi';
  private phase: Phase = 'off';
  private route: THREE.Vector3[] = [];
  private atlas: StreetAtlas | null = null;
  private waitT = 0;
  private bobT = 0;
  private carY = 2;

  onEta: (seconds: number) => void = () => {};
  onArrived: () => void = () => {};
  onRideEnd: (dest: string) => void = () => {};
  /** Wired by main: an override destination (e.g. "meet Bran") or null for the scenic default. */
  pickDestination: () => { label: string; x: number; z: number } | null = () => null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly player: Player,
    private readonly island: () => IslandView | null,
  ) {}

  get state(): Phase { return this.phase; }
  get cartLabel(): string { return CARTS[this.kind].label; }
  get pos(): THREE.Vector3 | null { return this.mesh?.position ?? null; }

  private streets(): StreetAtlas | null {
    const view = this.island();
    if (!view) return null;
    if (!this.atlas) this.atlas = new StreetAtlas(view);
    return this.atlas;
  }

  /** Player is close enough to board a waiting cart. */
  nearCart(maxDist = 3.2): boolean {
    return this.phase === 'waiting' && !!this.mesh &&
      this.mesh.position.distanceTo(this.player.pos) < maxDist;
  }

  async summon(kind: CartKind): Promise<void> {
    const streets = this.streets();
    if (this.phase !== 'off' || !streets) return;
    this.kind = kind;
    this.phase = 'arriving';
    const spec = CARTS[kind];
    const tpl = await propTemplate(spec.file, 'length');
    if (this.phase !== 'arriving') return; // cancelled while loading
    const curb = streets.curb(this.player.pos.x, this.player.pos.z);
    this.route = streets.route(streets.depot, curb) ?? [];
    const m = tpl.clone();
    m.scale.setScalar(spec.length);
    const [sx, sz] = streets.depot;
    this.carY = this.groundY(sx + 0.5, sz + 0.5);
    m.position.set(sx + 0.5, this.carY, sz + 0.5);
    if (this.route.length) {
      const first = this.route[0];
      m.rotation.y = Math.atan2(first.x - m.position.x, first.z - m.position.z);
    }
    this.scene.add(m);
    this.mesh = m;
    honk(kind === 'taxi' ? 2 : 1);
  }

  /** Cancel a pending cart (it turns around) or ignore otherwise. */
  cancel(): void {
    if (this.phase === 'arriving' || this.phase === 'waiting') this.leave();
  }

  board(): void {
    if (!this.nearCart() || !this.mesh) return;
    const streets = this.streets()!;
    this.phase = 'riding';
    this.player.view.root.visible = false;
    this.player.controlled = false;     // the cart owns the hero's pose now
    document.body.dataset.typing = '1'; // freeze WASD while riding
    const here: [number, number] = [Math.floor(this.mesh.position.x), Math.floor(this.mesh.position.z)];
    // Destination: a chosen rendezvous (an NPC picked on the phone) wins;
    // otherwise the scenic default — from the city you ride north over the
    // Golden Gate to the vista point, from Marin back down to the plaza.
    const override = this.pickDestination();
    if (override) {
      this.dest = { label: override.label, to: streets.curb(override.x, override.z) };
    } else if (this.mesh.position.z > 25) {
      this.dest = { label: 'the Golden Gate vista', to: streets.curb(47.5, 2.2) };
    } else {
      const plaza = this.island()!.poi('plaza')?.pos ?? { x: 52, y: 2, z: 44 };
      this.dest = { label: 'the plaza', to: streets.curb(plaza.x, plaza.z) };
    }
    this.route = streets.route(here, this.dest.to) ?? [];
  }

  private dest: { label: string; to: [number, number] } = { label: 'the plaza', to: [0, 0] };

  private leave(): void {
    if (!this.mesh) { this.despawn(); return; }
    const streets = this.streets();
    this.phase = 'leaving';
    const here: [number, number] = [Math.floor(this.mesh.position.x), Math.floor(this.mesh.position.z)];
    this.route = streets?.route(here, streets.depot) ?? [];
    if (!this.route.length) this.despawn();
  }

  private groundY(x: number, z: number): number {
    return Math.max(1, this.island()?.heightAt(x, z) ?? 1);
  }

  update(dt: number): void {
    const m = this.mesh;
    if (!m || this.phase === 'off') return;
    this.bobT += dt;
    // Streets climb the hills in one-block steps; ease the chassis over them.
    this.carY += (this.groundY(m.position.x, m.position.z) - this.carY) * Math.min(1, dt * 9);

    if (this.phase === 'waiting') {
      this.waitT -= dt;
      m.position.y = this.carY + Math.sin(this.bobT * 3) * 0.02;
      if (this.waitT <= 0) this.leave();
      return;
    }

    const target = this.route[0] ?? null;
    if (!target) { // route done
      if (this.phase === 'arriving') {
        this.phase = 'waiting'; // parked at the curb nearest the player
        this.waitT = 45;
        this.onArrived();
        honk(2);
      } else if (this.phase === 'riding') this.finishRide();
      else this.despawn(); // leaving
      return;
    }

    const flat = new THREE.Vector3(target.x - m.position.x, 0, target.z - m.position.z);
    const dist = flat.length();
    if (dist < 0.35) this.route.shift();
    flat.normalize();
    m.position.x += flat.x * SPEED * dt;
    m.position.z += flat.z * SPEED * dt;
    m.position.y = this.carY + Math.abs(Math.sin(this.bobT * 9)) * 0.035;

    const yaw = Math.atan2(flat.x, flat.z);
    let d = yaw - m.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    m.rotation.y += d * Math.min(1, dt * 6);

    if (this.phase === 'arriving') {
      let remaining = dist;
      for (let i = 1; i < this.route.length; i++) {
        remaining += Math.hypot(this.route[i].x - this.route[i - 1].x, this.route[i].z - this.route[i - 1].z);
      }
      this.onEta(remaining / SPEED);
    }
    if (this.phase === 'riding') { // the player is inside
      this.player.pos.set(m.position.x, this.groundY(m.position.x, m.position.z), m.position.z);
      this.player.rot = m.rotation.y;
    }
  }

  private finishRide(): void {
    const island = this.island();
    const m = this.mesh!;
    this.player.view.root.visible = true;
    this.player.controlled = true;
    delete document.body.dataset.typing;
    // Step out beside the cart — prefer the sidewalk over the roadway.
    let out: THREE.Vector3 | null = null;
    outer: for (const a of [m.rotation.y + Math.PI / 2, m.rotation.y - Math.PI / 2, m.rotation.y + Math.PI]) {
      for (const r of [1.6, 2.4]) {
        const c = new THREE.Vector3(m.position.x + Math.sin(a) * r, 0, m.position.z + Math.cos(a) * r);
        if (!island?.canMove(m.position.x, m.position.z, c.x, c.z)) continue;
        const t = island.tileAt(c.x, c.z);
        out = out ?? c;
        if (t !== 'r' && t !== 'b') { out = c; break outer; }
      }
    }
    if (out && island) this.player.pos.set(out.x, island.heightAt(out.x, out.z), out.z);
    this.onRideEnd(this.dest.label);
    honk(1);
    this.leave();
  }

  private despawn(): void {
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh = null;
    this.phase = 'off';
  }
}

/** Two-tone kawaii honk, no audio file needed. */
function honk(times: number): void {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const t = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(i % 2 ? 392 : 523, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    }
    setTimeout(() => void ctx.close(), 800);
  } catch { /* no audio, no problem */ }
}
