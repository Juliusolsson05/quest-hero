import * as THREE from 'three';
import type { IslandView } from './world';
import type { Player } from './player';
import { propTemplate } from './props3d';

/**
 * The Cartly fleet. A summoned cart spawns on the south causeway, rolls in
 * over the Golden Gate, parks beside the player, and — if they hop in —
 * ferries them across the island. Pure client-side theatre: the hub never
 * hears about it, so it can't break anyone else's demo.
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

/** Rolls in from the sea road: over the bridge, up the dock path, to you. */
const APPROACH: [number, number][] = [[24.5, 41.5], [24.5, 36.5], [24.3, 31.5]];
const SPEED = 4; // slow enough to savour the bridge crossing

type Phase = 'off' | 'arriving' | 'waiting' | 'riding' | 'leaving';

export class CartService {
  private mesh: THREE.Group | null = null;
  private kind: CartKind = 'taxi';
  private phase: Phase = 'off';
  private route: THREE.Vector3[] = [];
  private waitT = 0;
  private bobT = 0;

  onEta: (seconds: number) => void = () => {};
  onArrived: () => void = () => {};
  onRideEnd: (dest: string) => void = () => {};

  constructor(
    private readonly scene: THREE.Scene,
    private readonly player: Player,
    private readonly island: () => IslandView | null,
  ) {}

  get state(): Phase { return this.phase; }
  get cartLabel(): string { return CARTS[this.kind].label; }
  get pos(): THREE.Vector3 | null { return this.mesh?.position ?? null; }

  /** Player is close enough to board a waiting cart. */
  nearCart(maxDist = 2.6): boolean {
    return this.phase === 'waiting' && !!this.mesh &&
      this.mesh.position.distanceTo(this.player.pos) < maxDist;
  }

  async summon(kind: CartKind): Promise<void> {
    if (this.phase !== 'off' || !this.island()) return;
    this.kind = kind;
    this.phase = 'arriving';
    const spec = CARTS[kind];
    const tpl = await propTemplate(spec.file, 'length');
    if (this.phase !== 'arriving') return; // cancelled while loading
    const m = tpl.clone();
    m.scale.setScalar(spec.length);
    const [sx, sz] = APPROACH[0];
    m.position.set(sx, this.groundY(sx, sz), sz);
    this.scene.add(m);
    this.mesh = m;
    this.route = APPROACH.slice(1).map(([x, z]) => new THREE.Vector3(x, 0, z));
    honk(kind === 'taxi' ? 2 : 1);
  }

  /** Cancel a pending cart (it turns around) or ignore otherwise. */
  cancel(): void {
    if (this.phase === 'arriving' || this.phase === 'waiting') this.leave();
  }

  board(): void {
    if (!this.nearCart()) return;
    this.phase = 'riding';
    this.player.view.root.visible = false;
    this.player.controlled = false;     // the cart owns the hero's pose now
    document.body.dataset.typing = '1'; // freeze WASD while riding
    // Destination: whichever plaza/bridge end is the longer, nicer ride.
    const island = this.island()!;
    const plaza = island.poi('plaza')?.pos ?? { x: 24, y: 2, z: 24 };
    const toPlaza = this.mesh!.position.distanceTo(new THREE.Vector3(plaza.x, 0, plaza.z));
    this.dest = toPlaza > 8
      ? { label: 'the plaza', wp: [new THREE.Vector3(24.3, 0, 27.5), new THREE.Vector3(24.5, 0, 25.2)] }
      : { label: 'the Golden Gate', wp: [new THREE.Vector3(24.3, 0, 31.5), new THREE.Vector3(24.5, 0, 35.2)] };
    this.route = [...this.dest.wp];
  }

  private dest = { label: 'the plaza', wp: [] as THREE.Vector3[] };

  private leave(): void {
    this.phase = 'leaving';
    this.route = [...APPROACH].reverse().map(([x, z]) => new THREE.Vector3(x, 0, z));
  }

  private groundY(x: number, z: number): number {
    return Math.max(1, this.island()?.heightAt(x, z) ?? 1);
  }

  update(dt: number): void {
    const m = this.mesh;
    if (!m || this.phase === 'off') return;
    this.bobT += dt;

    if (this.phase === 'waiting') {
      this.waitT -= dt;
      m.position.y = this.groundY(m.position.x, m.position.z) + Math.sin(this.bobT * 3) * 0.02;
      if (this.waitT <= 0) this.leave();
      return;
    }

    // Where are we headed this frame?
    let target = this.route[0] ?? null;
    if (this.phase === 'arriving' && !this.route.length) {
      target = new THREE.Vector3(this.player.pos.x, 0, this.player.pos.z);
      if (m.position.distanceTo(this.player.pos) < 2.2) { // pulled up beside you
        this.phase = 'waiting';
        this.waitT = 30;
        this.onArrived();
        honk(2);
        return;
      }
    }
    if (!target) { // route done
      if (this.phase === 'riding') this.finishRide();
      else this.despawn(); // leaving
      return;
    }

    const flat = new THREE.Vector3(target.x - m.position.x, 0, target.z - m.position.z);
    const dist = flat.length();
    if (dist < 0.35 && this.route.length) this.route.shift();
    flat.normalize();
    m.position.x += flat.x * SPEED * dt;
    m.position.z += flat.z * SPEED * dt;
    m.position.y = this.groundY(m.position.x, m.position.z) + Math.abs(Math.sin(this.bobT * 9)) * 0.035;

    const yaw = Math.atan2(flat.x, flat.z);
    let d = yaw - m.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    m.rotation.y += d * Math.min(1, dt * 6);

    if (this.phase === 'arriving') {
      const remaining = this.route.reduce((acc, wp, i) => {
        const from = i === 0 ? m.position : this.route[i - 1];
        return acc + Math.hypot(wp.x - from.x, wp.z - from.z);
      }, 0) + (this.route.length ? Math.hypot(this.player.pos.x - this.route[this.route.length - 1].x, this.player.pos.z - this.route[this.route.length - 1].z) : dist);
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
    // Step out onto the curb beside the cart.
    const side = new THREE.Vector3(Math.cos(m.rotation.y), 0, -Math.sin(m.rotation.y));
    const out = m.position.clone().add(side.multiplyScalar(1.4));
    if (island?.walkable(out.x, out.z, island.heightAt(m.position.x, m.position.z))) {
      this.player.pos.set(out.x, island.heightAt(out.x, out.z), out.z);
    }
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
