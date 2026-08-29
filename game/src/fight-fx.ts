import * as THREE from 'three';
import { IRS_ARENA, shadedBox } from './arena';

/**
 * The fight's visual arsenal, all pooled: the aiming laser and its floor
 * reticle, arcing rockets with smoke trails, explosions (flash, shockwave,
 * debris, scorch), SMG tracers with muzzle flash and impact sparks, voxel
 * gibs for the player's untimely audit, and confetti for Mark's.
 */

const FLOOR = IRS_ARENA.floorY;

interface Debris { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number; max: number }

export class FightFx {
  readonly group = new THREE.Group();

  // laser + reticle
  private readonly laserCore: THREE.Mesh;
  private readonly laserGlow: THREE.Mesh;
  private readonly laserMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly reticle: THREE.Group;
  private readonly retRing: THREE.MeshBasicMaterial;
  private retT = 0;

  // rocket
  private readonly rocket: THREE.Group;
  private readonly flame: THREE.Mesh;
  private rocketFrom = new THREE.Vector3();
  private rocketTo = new THREE.Vector3();
  private rocketT = -1;
  private rocketDur = 1;
  private trailAcc = 0;

  // pools
  private readonly smoke: { m: THREE.Mesh; life: number }[] = [];
  private readonly debris: Debris[] = [];
  private readonly tracers: { m: THREE.Mesh; life: number }[] = [];
  private readonly flashes: { m: THREE.Mesh; life: number; grow: number }[] = [];
  private readonly scorches: { m: THREE.Mesh; life: number }[] = [];

  constructor() {
    this.laserMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.22, depthWrite: false });
    const unit = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    unit.rotateX(Math.PI / 2); // length along +z so lookAt aims it
    this.laserCore = new THREE.Mesh(unit, this.laserMat);
    this.laserGlow = new THREE.Mesh(unit, this.glowMat);
    this.laserCore.visible = this.laserGlow.visible = false;
    this.group.add(this.laserCore, this.laserGlow);

    this.reticle = new THREE.Group();
    this.retRing = new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1.0, 26), this.retRing);
    ring.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), this.retRing);
    dot.rotation.x = -Math.PI / 2;
    const tick = () => {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.09), this.retRing);
      t.rotation.x = -Math.PI / 2;
      this.reticle.add(t);
      return t;
    };
    for (let i = 0; i < 4; i++) {
      const t = tick();
      const a = (i / 4) * Math.PI * 2;
      t.position.set(Math.cos(a) * 1.24, 0, Math.sin(a) * 1.24);
      t.rotation.z = -a;
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
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.26), olive);
      const a = (i / 4) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.18, Math.sin(a) * 0.18, -0.38);
      fin.rotation.z = a;
      this.rocket.add(fin);
    }
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.55, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95 }),
    );
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.z = -0.75;
    this.rocket.add(body, nose, this.flame);
    this.rocket.visible = false;
    this.group.add(this.rocket);
  }

  // ── laser ────────────────────────────────────────────────────────────────

  laserShow(from: THREE.Vector3, to: THREE.Vector3, locked: boolean, t: number): void {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const len = from.distanceTo(to);
    for (const [m, r] of [[this.laserCore, 0.03], [this.laserGlow, 0.1]] as const) {
      m.visible = true;
      m.position.copy(mid);
      m.scale.set(r, r, len);
      m.lookAt(to);
    }
    // locked: strobe white-hot; tracking: steady menace
    const strobe = locked ? (Math.sin(t * 40) > 0 ? 0xfff1e8 : 0xff4a3d) : 0xff4a3d;
    this.laserMat.color.setHex(strobe);
    this.reticle.visible = true;
    this.reticle.position.set(to.x, FLOOR + 0.04, to.z);
    this.retT += 0.016;
    const pulse = locked ? 1 + Math.sin(t * 24) * 0.18 : 1 + Math.sin(this.retT * 5) * 0.07;
    this.reticle.scale.setScalar(pulse);
    this.reticle.rotation.y = locked ? this.reticle.rotation.y : this.reticle.rotation.y + 0.02;
    this.retRing.color.setHex(strobe);
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
    this.flashAt(from, 0xffe1a8, 0.5, 8);
  }

  rocketAbort(): void { this.rocketT = -1; this.rocket.visible = false; }
  get rocketFlying(): boolean { return this.rocketT >= 0; }

  /** Where the rocket is right now (for the whistle of near misses). */
  private rocketPos(t: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(this.rocketFrom, this.rocketTo, t);
    out.y += Math.sin(t * Math.PI) * 6.5; // the lob
    return out;
  }

  // ── bursts ───────────────────────────────────────────────────────────────

  private flashAt(at: THREE.Vector3, color: number, size: number, grow: number): void {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    m.position.copy(at);
    this.group.add(m);
    this.flashes.push({ m, life: 0.32, grow });
  }

  explode(at: THREE.Vector3): void {
    this.flashAt(at, 0xfff1d0, 0.6, 13);
    this.flashAt(at, 0xff8c42, 0.4, 10);
    // shockwave ring
    const ringM = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.12, 6, 26),
      new THREE.MeshBasicMaterial({ color: 0xffd9a8, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ringM.rotation.x = Math.PI / 2;
    ringM.position.set(at.x, FLOOR + 0.1, at.z);
    this.group.add(ringM);
    this.flashes.push({ m: ringM, life: 0.5, grow: 16 });
    // debris
    for (let i = 0; i < 22; i++) {
      const s = 0.1 + Math.random() * 0.16;
      const m = new THREE.Mesh(shadedBox(s, s, s), new THREE.MeshStandardMaterial({
        color: [0x3b3e4a, 0x8f3b3b, 0x2c2f3a, 0xff8c42][i % 4], vertexColors: true, transparent: true,
      }));
      m.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 5), 3 + Math.random() * 6, Math.sin(a) * (2 + Math.random() * 5));
      this.group.add(m);
      this.debris.push({ m, v, spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9), life: 1.3, max: 1.3 });
    }
    // scorch
    const sc = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 22),
      new THREE.MeshBasicMaterial({ color: 0x17181f, transparent: true, opacity: 0.65, depthWrite: false }),
    );
    sc.rotation.x = -Math.PI / 2;
    sc.position.set(at.x, FLOOR + 0.025 + this.scorches.length * 0.002, at.z);
    this.group.add(sc);
    this.scorches.push({ m: sc, life: 7 });
  }

  /** One SMG round: tracer, muzzle flash, impact spark. */
  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.035, len * 0.55),
      new THREE.MeshBasicMaterial({ color: 0xffd977, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    m.position.copy(from).addScaledVector(dir, 0.6);
    m.lookAt(to);
    this.group.add(m);
    this.tracers.push({ m, life: 0.07 });
    this.flashAt(from, 0xfff3c8, 0.1, 2.2);
    this.flashAt(to, 0xffe1a8, 0.09, 2.6);
  }

  /** The player's untimely audit: a burst of hero-coloured voxels. */
  gibs(at: THREE.Vector3): void {
    const palette = [0xa8e6cf, 0x8fd4b8, 0xffe8cf, 0x5a5566, 0x2c2833];
    for (let i = 0; i < 34; i++) {
      const s = 0.09 + Math.random() * 0.15;
      const m = new THREE.Mesh(shadedBox(s, s, s), new THREE.MeshStandardMaterial({
        color: palette[i % palette.length], vertexColors: true, transparent: true,
      }));
      m.position.set(at.x, at.y + 0.4 + Math.random() * 0.9, at.z);
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (1.5 + Math.random() * 4), 3.5 + Math.random() * 5, Math.sin(a) * (1.5 + Math.random() * 4));
      this.group.add(m);
      this.debris.push({ m, v, spin: new THREE.Vector3(Math.random() * 11, Math.random() * 11, Math.random() * 11), life: 1.7, max: 1.7 });
    }
    this.flashAt(at.clone().setY(at.y + 0.8), 0xffe1a8, 0.5, 7);
  }

  /** Refund approved: gold and pastel paper from the oculus. */
  confetti(): void {
    const { cx, cz } = IRS_ARENA;
    const palette = [0xffd977, 0xaee3c8, 0xffb7d5, 0xfff3dd, 0xff8c42];
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.24),
        new THREE.MeshBasicMaterial({ color: palette[i % palette.length], side: THREE.DoubleSide, transparent: true }),
      );
      m.position.set(cx + (Math.random() - 0.5) * 6, FLOOR + 12 + Math.random() * 4, cz + (Math.random() - 0.5) * 6);
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.6, -1.1 - Math.random() * 0.9, (Math.random() - 0.5) * 1.6);
      this.group.add(m);
      this.debris.push({ m, v, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), life: 7, max: 7 });
    }
  }

  clear(): void {
    this.laserHide();
    this.rocketAbort();
    for (const list of [this.smoke, this.tracers, this.flashes, this.scorches] as const)
      for (const e of list) this.group.remove(e.m);
    for (const d of this.debris) this.group.remove(d.m);
    this.smoke.length = this.tracers.length = this.flashes.length = this.scorches.length = this.debris.length = 0;
  }

  /** Advance everything; returns true the frame the rocket lands. */
  update(dt: number): boolean {
    let landed = false;

    if (this.rocketT >= 0) {
      this.rocketT += dt / this.rocketDur;
      const t = Math.min(1, this.rocketT);
      const pos = this.rocketPos(t, new THREE.Vector3());
      const ahead = this.rocketPos(Math.min(1, t + 0.02), new THREE.Vector3());
      this.rocket.position.copy(pos);
      this.rocket.lookAt(ahead);
      (this.flame.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.random() * 0.4;
      this.flame.scale.setScalar(0.8 + Math.random() * 0.5);
      this.trailAcc += dt;
      if (this.trailAcc > 0.035) {
        this.trailAcc = 0;
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.16 + Math.random() * 0.1, 0),
          new THREE.MeshBasicMaterial({ color: 0xcfd2d8, transparent: true, opacity: 0.55, depthWrite: false }),
        );
        m.position.copy(pos);
        this.group.add(m);
        this.smoke.push({ m, life: 0.8 });
      }
      if (t >= 1) {
        landed = true;
        this.rocketT = -1;
        this.rocket.visible = false;
      }
    }

    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life -= dt;
      s.m.scale.multiplyScalar(1 + dt * 2.2);
      (s.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life * 0.7);
      s.m.position.y += dt * 0.5;
      if (s.life <= 0) { this.group.remove(s.m); this.smoke.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.m.scale.multiplyScalar(1 + dt * f.grow);
      (f.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.life * 2.8);
      if (f.life <= 0) { this.group.remove(f.m); this.flashes.splice(i, 1); }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) { this.group.remove(tr.m); this.tracers.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.v.y -= 11 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < FLOOR + 0.06) { d.m.position.y = FLOOR + 0.06; d.v.y *= -0.35; d.v.x *= 0.7; d.v.z *= 0.7; }
      d.m.rotation.x += d.spin.x * dt;
      d.m.rotation.y += d.spin.y * dt;
      const mat = d.m.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, d.life / (d.max * 0.3));
      if (d.life <= 0) { this.group.remove(d.m); this.debris.splice(i, 1); }
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const sc = this.scorches[i];
      sc.life -= dt;
      (sc.m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.65, sc.life * 0.35);
      if (sc.life <= 0) { this.group.remove(sc.m); this.scorches.splice(i, 1); }
    }
    return landed;
  }
}
