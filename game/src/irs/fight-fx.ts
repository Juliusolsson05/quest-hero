import * as THREE from 'three';
import { IRS_ARENA, shadedBox } from './arena';

/**
 * The fight's visual arsenal. Everything here is POOLED: geometries are
 * shared, materials and meshes are allocated once in the constructor, and
 * spawning an effect only flips a pooled entry live and sets its transform.
 * Zero allocation and zero disposal at runtime — an earlier draft created
 * (and leaked) geometry per tracer, which at 11 rounds/sec was a frame-rate
 * funeral.
 */

const FLOOR = IRS_ARENA.floorY;

// shared unit geometries, scaled per-instance
const G_BOX = new THREE.BoxGeometry(1, 1, 1);
const G_VOX = shadedBox(1, 1, 1);
const G_ICO = new THREE.IcosahedronGeometry(1, 0);
const G_PLANE = new THREE.PlaneGeometry(1, 1);
const G_CYL = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  g.rotateX(Math.PI / 2); // length along +z so lookAt aims it
  return g;
})();

interface Puff { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }
interface Spark { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; grow: number }
interface Chunk {
  m: THREE.Mesh; mat: THREE.MeshStandardMaterial;
  v: THREE.Vector3; sx: number; sy: number;
  life: number; max: number; gravity: number;
}
interface Burn { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }

export class FightFx {
  readonly group = new THREE.Group();

  // laser + reticle
  private readonly laserCore: THREE.Mesh;
  private readonly laserGlow: THREE.Mesh;
  private readonly laserMat: THREE.MeshBasicMaterial;
  private readonly reticle: THREE.Group;
  private readonly retMat: THREE.MeshBasicMaterial;
  private retT = 0;

  // the one rocket
  private readonly rocket: THREE.Group;
  private readonly flame: THREE.Mesh;
  private readonly flameMat: THREE.MeshBasicMaterial;
  private rocketFrom = new THREE.Vector3();
  private rocketTo = new THREE.Vector3();
  private rocketT = -1;
  private rocketDur = 1;
  private trailAcc = 0;

  // pools
  private readonly smoke: Puff[] = [];
  private readonly sparks: Spark[] = [];
  private readonly tracers: Puff[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly burns: Burn[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.laserMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.22, depthWrite: false });
    this.laserCore = new THREE.Mesh(G_CYL, this.laserMat);
    this.laserGlow = new THREE.Mesh(G_CYL, glowMat);
    this.laserCore.visible = this.laserGlow.visible = false;
    this.group.add(this.laserCore, this.laserGlow);

    this.reticle = new THREE.Group();
    this.retMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1.0, 26), this.retMat);
    ring.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), this.retMat);
    dot.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(G_PLANE, this.retMat);
      t.scale.set(0.34, 0.09, 1);
      t.rotation.x = -Math.PI / 2;
      const a = (i / 4) * Math.PI * 2;
      t.position.set(Math.cos(a) * 1.24, 0, Math.sin(a) * 1.24);
      t.rotation.z = -a;
      this.reticle.add(t);
    }
    this.reticle.add(ring, dot);
    this.reticle.visible = false;
    this.group.add(this.reticle);

    // one rocket in flight at a time — Mark is thorough, not spammy
    this.rocket = new THREE.Group();
    const olive = new THREE.MeshStandardMaterial({ color: 0x4c5a3f, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 8), olive);
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 8), new THREE.MeshStandardMaterial({ color: 0xb03a2e, roughness: 0.6 }));
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.62;
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(G_BOX, olive);
      fin.scale.set(0.04, 0.22, 0.26);
      const a = (i / 4) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.18, Math.sin(a) * 0.18, -0.38);
      fin.rotation.z = a;
      this.rocket.add(fin);
    }
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95 });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 8), this.flameMat);
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.z = -0.75;
    this.rocket.add(body, nose, this.flame);
    this.rocket.visible = false;
    this.group.add(this.rocket);

    // ── build the pools, once ──
    const pooled = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);
    this.smoke = pooled(36, () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xcfd2d8, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(G_ICO, mat);
      m.visible = false;
      this.group.add(m);
      return { m, mat, life: 0 };
    });
    this.sparks = pooled(28, () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(G_ICO, mat);
      m.visible = false;
      this.group.add(m);
      return { m, mat, life: 0, grow: 1 };
    });
    this.tracers = pooled(20, () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd977, transparent: true, opacity: 0.95, depthWrite: false });
      const m = new THREE.Mesh(G_BOX, mat);
      m.visible = false;
      this.group.add(m);
      return { m, mat, life: 0 };
    });
    this.chunks = pooled(120, () => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, transparent: true, roughness: 0.9 });
      const m = new THREE.Mesh(G_VOX, mat);
      m.visible = false;
      this.group.add(m);
      return { m, mat, v: new THREE.Vector3(), sx: 0, sy: 0, life: 0, max: 1, gravity: 11 };
    });
    this.burns = pooled(6, () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x17181f, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(new THREE.CircleGeometry(2.6, 22), mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.group.add(m);
      return { m, mat, life: 0 };
    });
  }

  // ── pool taps ────────────────────────────────────────────────────────────

  private nextDead<T extends { life: number }>(pool: T[]): T {
    let best = pool[0];
    for (const e of pool) {
      if (e.life <= 0) return e;
      if (e.life < best.life) best = e; // steal the oldest if full
    }
    return best;
  }

  private spark(at: THREE.Vector3, color: number, size: number, grow: number, life = 0.32): void {
    const s = this.nextDead(this.sparks);
    s.life = life;
    s.grow = grow;
    s.mat.color.setHex(color);
    s.mat.opacity = 0.95;
    s.m.visible = true;
    s.m.position.copy(at);
    s.m.scale.setScalar(size);
  }

  private chunk(at: THREE.Vector3, color: number, size: number, v: THREE.Vector3, life: number, gravity = 11): void {
    const c = this.nextDead(this.chunks);
    c.life = c.max = life;
    c.gravity = gravity;
    c.mat.color.setHex(color);
    c.mat.opacity = 1;
    c.m.visible = true;
    c.m.position.copy(at);
    c.m.scale.setScalar(size);
    c.v.copy(v);
    c.sx = Math.random() * 9;
    c.sy = Math.random() * 9;
  }

  // ── laser ────────────────────────────────────────────────────────────────

  laserShow(from: THREE.Vector3, to: THREE.Vector3, locked: boolean, t: number): void {
    const mid = this.tmp.copy(from).add(to).multiplyScalar(0.5);
    const len = from.distanceTo(to);
    this.laserCore.visible = this.laserGlow.visible = true;
    this.laserCore.position.copy(mid);
    this.laserCore.scale.set(0.03, 0.03, len);
    this.laserCore.lookAt(to);
    this.laserGlow.position.copy(mid);
    this.laserGlow.scale.set(0.1, 0.1, len);
    this.laserGlow.lookAt(to);
    const strobe = locked ? (Math.sin(t * 40) > 0 ? 0xfff1e8 : 0xff4a3d) : 0xff4a3d;
    this.laserMat.color.setHex(strobe);
    this.reticle.visible = true;
    this.reticle.position.set(to.x, FLOOR + 0.04, to.z);
    this.retT += 0.016;
    const pulse = locked ? 1 + Math.sin(t * 24) * 0.18 : 1 + Math.sin(this.retT * 5) * 0.07;
    this.reticle.scale.setScalar(pulse);
    if (!locked) this.reticle.rotation.y += 0.02;
    this.retMat.color.setHex(strobe);
  }

  laserHide(): void {
    this.laserCore.visible = this.laserGlow.visible = this.reticle.visible = false;
  }

  // ── rocket ───────────────────────────────────────────────────────────────

  rocketLaunch(from: THREE.Vector3, to: THREE.Vector3, dur: number): void {
    this.rocketFrom.copy(from);
    this.rocketTo.copy(to);
    this.rocketDur = dur;
    this.rocketT = 0;
    this.rocket.visible = true;
    this.spark(from, 0xffe1a8, 0.5, 8);
  }

  rocketAbort(): void { this.rocketT = -1; this.rocket.visible = false; }
  get rocketFlying(): boolean { return this.rocketT >= 0; }

  private rocketPos(t: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(this.rocketFrom, this.rocketTo, t);
    out.y += Math.sin(t * Math.PI) * 6.5; // the lob
    return out;
  }

  // ── bursts ───────────────────────────────────────────────────────────────

  explode(at: THREE.Vector3): void {
    this.spark(at, 0xfff1d0, 0.6, 13);
    this.spark(at, 0xff8c42, 0.4, 10);
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      this.tmp.set(Math.cos(a) * (2 + Math.random() * 5), 3 + Math.random() * 6, Math.sin(a) * (2 + Math.random() * 5));
      this.chunk(at, [0x3b3e4a, 0x8f3b3b, 0x2c2f3a, 0xff8c42][i % 4], 0.1 + Math.random() * 0.16, this.tmp, 1.3);
    }
    const b = this.nextDead(this.burns);
    b.life = 7;
    b.mat.opacity = 0.65;
    b.m.visible = true;
    b.m.position.set(at.x, FLOOR + 0.025, at.z);
  }

  /** One SMG round: tracer streak, muzzle flash, impact spark. */
  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const tr = this.nextDead(this.tracers);
    tr.life = 0.07;
    tr.mat.opacity = 0.95;
    tr.m.visible = true;
    const len = from.distanceTo(to);
    tr.m.scale.set(0.035, 0.035, Math.max(0.3, len * 0.55));
    tr.m.position.copy(from).lerp(to, 0.6);
    tr.m.lookAt(to);
    this.spark(from, 0xfff3c8, 0.1, 2.2, 0.06);
    this.spark(to, 0xffe1a8, 0.09, 2.6, 0.09);
  }

  /** The player's untimely audit: a burst of hero-coloured voxels. */
  gibs(at: THREE.Vector3): void {
    const palette = [0xa8e6cf, 0x8fd4b8, 0xffe8cf, 0x5a5566, 0x2c2833];
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      this.tmp.set(Math.cos(a) * (1.5 + Math.random() * 4), 3.5 + Math.random() * 5, Math.sin(a) * (1.5 + Math.random() * 4));
      const p = this.tmp;
      const pos = new THREE.Vector3(at.x, at.y + 0.4 + Math.random() * 0.9, at.z);
      const vel = p.clone();
      this.chunk(pos, palette[i % palette.length], 0.09 + Math.random() * 0.15, vel, 1.7);
    }
    this.spark(this.tmp.set(at.x, at.y + 0.8, at.z), 0xffe1a8, 0.5, 7);
  }

  /** Refund approved: gold and pastel paper from the oculus. */
  confetti(): void {
    const { cx, cz } = IRS_ARENA;
    const palette = [0xffd977, 0xaee3c8, 0xffb7d5, 0xfff3dd, 0xff8c42];
    for (let i = 0; i < 60; i++) {
      this.tmp.set((Math.random() - 0.5) * 1.6, -1.1 - Math.random() * 0.9, (Math.random() - 0.5) * 1.6);
      const pos = new THREE.Vector3(cx + (Math.random() - 0.5) * 6, FLOOR + 12 + Math.random() * 4, cz + (Math.random() - 0.5) * 6);
      this.chunk(pos, palette[i % palette.length], 0.2, this.tmp, 7, 0);
    }
  }

  clear(): void {
    this.laserHide();
    this.rocketAbort();
    for (const e of this.smoke) { e.life = 0; e.m.visible = false; }
    for (const e of this.sparks) { e.life = 0; e.m.visible = false; }
    for (const e of this.tracers) { e.life = 0; e.m.visible = false; }
    for (const e of this.chunks) { e.life = 0; e.m.visible = false; }
    for (const e of this.burns) { e.life = 0; e.m.visible = false; }
  }

  /** Advance everything; returns true the frame the rocket lands. */
  update(dt: number): boolean {
    let landed = false;

    if (this.rocketT >= 0) {
      this.rocketT += dt / this.rocketDur;
      const t = Math.min(1, this.rocketT);
      this.rocketPos(t, this.rocket.position);
      this.rocketPos(Math.min(1, t + 0.02), this.tmp);
      this.rocket.lookAt(this.tmp);
      this.flameMat.opacity = 0.6 + Math.random() * 0.4;
      this.flame.scale.setScalar(0.8 + Math.random() * 0.5);
      this.trailAcc += dt;
      if (this.trailAcc > 0.045) {
        this.trailAcc = 0;
        const s = this.nextDead(this.smoke);
        s.life = 0.8;
        s.mat.opacity = 0.55;
        s.m.visible = true;
        s.m.position.copy(this.rocket.position);
        s.m.scale.setScalar(0.16 + Math.random() * 0.1);
      }
      if (t >= 1) {
        landed = true;
        this.rocketT = -1;
        this.rocket.visible = false;
      }
    }

    for (const s of this.smoke) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.m.scale.multiplyScalar(1 + dt * 2.2);
      s.mat.opacity = Math.max(0, s.life * 0.7);
      s.m.position.y += dt * 0.5;
    }
    for (const f of this.sparks) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.m.visible = false; continue; }
      f.m.scale.multiplyScalar(1 + dt * f.grow);
      f.mat.opacity = Math.max(0, f.life * 2.8);
    }
    for (const tr of this.tracers) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      if (tr.life <= 0) tr.m.visible = false;
    }
    for (const c of this.chunks) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.m.visible = false; continue; }
      c.v.y -= c.gravity * dt;
      c.m.position.addScaledVector(c.v, dt);
      if (c.m.position.y < FLOOR + 0.06 && c.gravity > 0) {
        c.m.position.y = FLOOR + 0.06;
        c.v.y *= -0.35; c.v.x *= 0.7; c.v.z *= 0.7;
      }
      c.m.rotation.x += c.sx * dt;
      c.m.rotation.y += c.sy * dt;
      c.mat.opacity = Math.min(1, c.life / (c.max * 0.3));
    }
    for (const b of this.burns) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.m.visible = false; continue; }
      b.mat.opacity = Math.min(0.65, b.life * 0.35);
    }
    return landed;
  }
}
