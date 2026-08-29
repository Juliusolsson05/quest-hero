import * as THREE from 'three';
import { IRS_ARENA, PILLARS, shadedBox, type IrsArena } from './arena';
import { FightFx } from './fight-fx';
import type { Player } from '../player';

/**
 * The audit, phase one: the shooter. Ten seconds of IRS Mark getting mad,
 * then the bazooka loop — a laser that hunts you but stops at cover, a lock,
 * a rocket you have time to not be under, and an explosion that respects
 * pillars. Your SMG fires where the crosshair looks, not where the game
 * wishes you were looking.
 *
 * Built to be interrupted: `frozen` suspends the whole loop mid-fight, and
 * damage goes through damageBoss/damagePlayer — that's where the upcoming
 * MCP question rounds (trivia verdict → rocket cinematic) will plug in.
 */

// ── tuning ──────────────────────────────────────────────────────────────────
const COUNTDOWN = 10;
const AIM_T = 2.2;      // laser tracks you
const LOCK_T = 0.5;     // laser freezes and strobes
const FLIGHT_T = 1.7;   // your time to not be there
const COOLDOWN_T = 1.2;
const BLAST_R = 3.4;
const BLAST_DMG = 38;   // point blank, falling to…
const BLAST_MIN = 10;   // …at the rim; zero behind a pillar
const PLAYER_HP = 100;
const MARK_HP = 1040;
const SMG_RPS = 11;
const SMG_DMG = 1.1;    // chip damage — the trivia rounds are where real damage happens
const MARK_R = 1.05;    // his hit cylinder
const MARK_H = 2.75;
const PILLAR_R = 0.95;  // pillar shaft radius for bullets and the laser
const ASSIST_RAD = 0.16; // aim assist: within ~9 degrees (horizontal) of Mark, the shot snaps
const AIM_ANCHOR_Y = 2.15; // the crosshair floats here, just above the hero's head

type Phase = 'off' | 'countdown' | 'aim' | 'lock' | 'flight' | 'cooldown' | 'victory' | 'audited';

export class BossFight {
  /** Future MCP question rounds set this to pause the shooter mid-fight. */
  frozen = false;

  private phase: Phase = 'off';
  private t = 0;
  private firing = false;
  private fireAcc = 0;
  private myHp = PLAYER_HP;
  private markHp = MARK_HP;
  private aimPoint = new THREE.Vector3();
  private lockedPoint = new THREE.Vector3();
  private shakeT = 0;
  private repositionTo: { x: number; z: number } | null = null;
  private readonly fx = new FightFx();
  private readonly gun: THREE.Group;
  private lastBanner = '';

  // scratch vectors — the hot path allocates nothing
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();

  // HUD
  private readonly banner: HTMLDivElement;
  private readonly myBar: HTMLDivElement;
  private readonly myFill: HTMLDivElement;
  private readonly markBar: HTMLDivElement;
  private readonly markFill: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;

  constructor(
    scene: THREE.Scene,
    private readonly arena: IrsArena,
    private readonly player: Player,
    private readonly hooks: { onAudited: () => void; toast: (msg: string, emoji: string) => void },
  ) {
    scene.add(this.fx.group);
    this.fx.group.visible = false;

    // the player's SMG: compact, stubby, riding the right hip
    this.gun = new THREE.Group();
    const gm = new THREE.MeshStandardMaterial({ color: 0x2c2f3a, roughness: 0.6 });
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, m = gm) => {
      const b = new THREE.Mesh(shadedBox(w, h, d), m);
      b.position.set(x, y, z);
      this.gun.add(b);
      return b;
    };
    part(0.1, 0.12, 0.42, 0, 0, 0);                                    // receiver
    part(0.06, 0.06, 0.24, 0, 0.01, 0.3);                              // barrel
    part(0.08, 0.16, 0.09, 0, -0.13, -0.05);                           // grip
    part(0.06, 0.18, 0.06, 0, -0.14, 0.1);                             // mag
    part(0.04, 0.05, 0.2, 0, 0.09, -0.02,
      new THREE.MeshStandardMaterial({ color: 0xffd977, roughness: 0.4 })); // brass sight rail
    this.gun.position.set(0.32, 0.88, 0.18);
    this.gun.rotation.y = -0.08;
    this.gun.visible = false;
    player.view.root.add(this.gun);

    const el = (css: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.style.cssText = css;
      document.body.append(d);
      return d;
    };
    this.banner = el(
      'position:fixed;top:16%;left:0;right:0;text-align:center;z-index:30;pointer-events:none;' +
      'font:900 min(29px, 6.4vw) system-ui;color:#fff;text-shadow:0 3px 0 #28304a,0 0 26px rgba(255,74,61,.7);display:none;');
    const barCss = (bottom: string, w: string) =>
      `position:fixed;${bottom}left:50%;transform:translateX(-50%);width:${w};height:16px;z-index:30;` +
      'background:#1d1f2a;border:2px solid #2e3140;border-radius:9px;overflow:hidden;display:none;pointer-events:none;';
    this.myBar = el(barCss('bottom:26px;', 'min(280px, 60vw)'));
    this.myFill = document.createElement('div');
    this.myFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(#aee3c8,#7cc474);transition:width .12s';
    this.myBar.append(this.myFill);
    this.markBar = el(barCss('top:56px;', 'min(420px, 84vw)'));
    this.markFill = document.createElement('div');
    this.markFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(#ff9d96,#e4574f);transition:width .12s';
    this.markBar.append(this.markFill);
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;top:-24px;left:0;right:0;text-align:center;font:800 13px system-ui;color:#fffdf6;text-shadow:0 2px 0 #28304a';
    label.textContent = 'MARK — THE STARTUP ENEMY';
    this.markBar.append(label);
    this.vignette = el(
      'position:fixed;inset:0;pointer-events:none;z-index:29;opacity:0;transition:opacity .35s;' +
      'box-shadow:inset 0 0 140px 50px rgba(228,60,45,.55);');
    // crosshair: four ticks and a dot, floating above the hero — the SMG
    // shoots along the camera ray through this point
    this.crosshair = el(
      'position:fixed;left:0;top:0;width:26px;height:26px;will-change:transform;' +
      'z-index:30;pointer-events:none;display:none;');
    this.crosshair.innerHTML =
      '<svg viewBox="0 0 26 26" width="26" height="26">' +
      '<g stroke="#fffdf6" stroke-width="2.4" opacity="0.9">' +
      '<line x1="13" y1="0" x2="13" y2="7"/><line x1="13" y1="19" x2="13" y2="26"/>' +
      '<line x1="0" y1="13" x2="7" y2="13"/><line x1="19" y1="13" x2="26" y2="13"/></g>' +
      '<circle cx="13" cy="13" r="1.6" fill="#ffd977"/></svg>';
  }

  get active(): boolean { return this.phase !== 'off'; }

  begin(): void {
    this.phase = 'countdown';
    this.t = COUNTDOWN;
    this.myHp = PLAYER_HP;
    this.markHp = MARK_HP;
    this.firing = false;
    this.gun.visible = true;
    this.fx.group.visible = true;
    this.arena.boss.setMode('rage');
    this.banner.style.display = this.myBar.style.display = this.markBar.style.display = 'block';
    this.crosshair.style.display = 'block';
    this.syncBars();
  }

  reset(): void {
    this.phase = 'off';
    this.frozen = false;
    this.firing = false;
    this.gun.visible = false;
    this.fx.clear();
    this.fx.group.visible = false;
    this.arena.boss.setMode('idle');
    this.arena.boss.ragePower = 0;
    this.banner.style.display = this.myBar.style.display = this.markBar.style.display = 'none';
    this.crosshair.style.display = 'none';
    this.vignette.style.opacity = '0';
    this.lastBanner = '';
    this.player.view.root.visible = true;
  }

  setFiring(on: boolean): void { this.firing = on; }

  /** External damage entry — the MCP verdict cinematic lands here later. */
  damageBoss(n: number): void {
    if (this.phase === 'off' || this.phase === 'victory' || this.phase === 'audited') return;
    this.markHp = Math.max(0, this.markHp - n);
    this.arena.boss.flinch();
    this.syncBars();
    if (this.markHp <= 0) this.win();
  }

  damagePlayer(n: number): void {
    if (this.phase === 'off' || this.phase === 'victory' || this.phase === 'audited') return;
    this.myHp = Math.max(0, this.myHp - n);
    this.vignette.style.opacity = '1';
    setTimeout(() => { if (this.myHp > 0) this.vignette.style.opacity = '0'; }, 380);
    this.shakeT = Math.max(this.shakeT, 0.45);
    this.syncBars();
    if (this.myHp <= 0) this.lose();
  }

  private syncBars(): void {
    this.myFill.style.width = `${(this.myHp / PLAYER_HP) * 100}%`;
    this.markFill.style.width = `${(this.markHp / MARK_HP) * 100}%`;
  }

  private setBanner(text: string): void {
    if (text === this.lastBanner) return; // no same-value DOM writes at 60fps
    this.lastBanner = text;
    this.banner.textContent = text;
  }

  private win(): void {
    this.phase = 'victory';
    this.fx.laserHide();
    this.fx.rocketAbort();
    this.arena.boss.setMode('defeat');
    this.fx.confetti();
    this.setBanner('MARK IS DEFEATED — GO BUILD');
    this.banner.style.textShadow = '0 3px 0 #28304a, 0 0 26px rgba(255,217,119,.8)';
    this.crosshair.style.display = 'none';
    this.hooks.toast('Mark drops the bazooka. "…maybe you will make it after all."', '💸');
    setTimeout(() => { this.banner.style.display = 'none'; }, 4200);
  }

  private lose(): void {
    this.phase = 'audited';
    this.fx.laserHide();
    this.fx.rocketAbort();
    this.fx.gibs(this.player.pos);
    this.player.view.root.visible = false;
    this.crosshair.style.display = 'none';
    this.setBanner('MARK WAS RIGHT ABOUT YOU');
    this.banner.style.display = 'block';
    setTimeout(() => this.hooks.onAudited(), 1300);
  }

  // ── geometry helpers (2D, zero-alloc) ────────────────────────────────────

  /**
   * Clip the segment a→b at the first pillar it crosses; writes the clipped
   * end into `out` and returns true if a pillar got in the way. This is what
   * makes cover real: the laser, the lock, and your bullets all stop here.
   */
  private clipAtPillars(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, r = PILLAR_R): boolean {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) { out.copy(b); return false; }
    let bestT = 1;
    for (const p of PILLARS) {
      const fx = a.x - p.x, fz = a.z - p.z;
      const bq = 2 * (fx * dx + fz * dz);
      const cq = fx * fx + fz * fz - r * r;
      const disc = bq * bq - 4 * len2 * cq;
      if (disc <= 0) continue;
      const t = (-bq - Math.sqrt(disc)) / (2 * len2);
      if (t > 0.02 && t < bestT) bestT = t;
    }
    out.set(a.x + dx * bestT, b.y, a.z + dz * bestT);
    return bestT < 1;
  }

  /** True when a pillar stands between the blast and the player: full cover. */
  private coverBetween(a: THREE.Vector3, b: THREE.Vector3): boolean {
    return this.clipAtPillars(a, b, this.tmpD, PILLAR_R - 0.15);
  }

  /**
   * The aim system: a ray from the camera through the crosshair floating
   * above the hero's head. If it passes within ~9 degrees of Mark
   * horizontally (vertical is forgiven — players aim in yaw), it snaps to
   * his chest. Returns the world point the shot lands on — Mark's hit
   * cylinder, a pillar, or a wall — and whether that point is Mark.
   */
  private aimRay(hit: THREE.Vector3): boolean {
    const cam = this.player.camera;
    const origin = this.tmpC.copy(cam.position);
    const dir = this.tmpD
      .set(this.player.pos.x, this.player.pos.y + AIM_ANCHOR_Y, this.player.pos.z)
      .sub(origin)
      .normalize();

    {
      const boss = this.arena.boss.root.position;
      const mx = boss.x - origin.x, my = boss.y + 1.8 - origin.y, mz = boss.z - origin.z;
      const mLen = Math.sqrt(mx * mx + my * my + mz * mz);
      const mH = Math.hypot(mx, mz);
      const dH = Math.hypot(dir.x, dir.z);
      if (mH > 1e-4 && dH > 1e-4) {
        const cosH = (dir.x * mx + dir.z * mz) / (mH * dH);
        const vAim = Math.atan2(dir.y, dH);
        const vMark = Math.atan2(my, mH);
        if (cosH > Math.cos(ASSIST_RAD) && Math.abs(vAim - vMark) < 0.4) {
          dir.set(mx / mLen, my / mLen, mz / mLen);
        }
      }
    }

    // far point: walk the ray to the arena walls (or 60 units, whichever first)
    let tMax = 60;
    const B = IRS_ARENA.bounds;
    const wall = (o: number, d: number, lo: number, hi: number) => {
      if (Math.abs(d) < 1e-6) return;
      for (const bound of [lo - 0.2, hi + 0.2]) {
        const t = (bound - o) / d;
        if (t > 0.5 && t < tMax) tMax = t;
      }
    };
    wall(origin.x, dir.x, B.minX, B.maxX);
    wall(origin.z, dir.z, B.minZ, B.maxZ);
    if (dir.y < -1e-6) { const t = (IRS_ARENA.floorY - origin.y) / dir.y; if (t > 0.5 && t < tMax) tMax = t; }

    // Mark: ray vs vertical cylinder at his root
    const m = this.arena.boss.root.position;
    let tMark = Infinity;
    {
      const ox = origin.x - m.x, oz = origin.z - m.z;
      const a = dir.x * dir.x + dir.z * dir.z;
      if (a > 1e-6) {
        const bq = 2 * (ox * dir.x + oz * dir.z);
        const cq = ox * ox + oz * oz - MARK_R * MARK_R;
        const disc = bq * bq - 4 * a * cq;
        if (disc > 0) {
          const t = (-bq - Math.sqrt(disc)) / (2 * a);
          const y = origin.y + dir.y * t;
          if (t > 0.5 && y > IRS_ARENA.floorY && y < IRS_ARENA.floorY + MARK_H) tMark = t;
        }
      }
    }

    // pillars: same test, they block your bullets too
    let tPillar = Infinity;
    for (const p of PILLARS) {
      const ox = origin.x - p.x, oz = origin.z - p.z;
      const a = dir.x * dir.x + dir.z * dir.z;
      if (a < 1e-6) continue;
      const bq = 2 * (ox * dir.x + oz * dir.z);
      const cq = ox * ox + oz * oz - PILLAR_R * PILLAR_R;
      const disc = bq * bq - 4 * a * cq;
      if (disc <= 0) continue;
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      const y = origin.y + dir.y * t;
      if (t > 0.5 && t < tPillar && y > IRS_ARENA.floorY && y < IRS_ARENA.floorY + 8) tPillar = t;
    }

    const tHit = Math.min(tMark, tPillar, tMax);
    hit.copy(origin).addScaledVector(dir, tHit);
    return tMark <= tPillar && tMark <= tMax;
  }

  private gunMuzzle(out: THREE.Vector3): THREE.Vector3 {
    const r = this.player.rot;
    const p = this.player.pos;
    return out.set(
      p.x + Math.cos(r) * 0.32 + Math.sin(r) * 0.5,
      p.y + 0.9,
      p.z - Math.sin(r) * 0.32 + Math.cos(r) * 0.5,
    );
  }

  /** Pin the crosshair to the screen position of the point the SMG aims through. */
  private syncCrosshair(): void {
    const v = this.tmpA.set(this.player.pos.x, this.player.pos.y + AIM_ANCHOR_Y, this.player.pos.z)
      .project(this.player.camera);
    const x = (v.x * 0.5 + 0.5) * innerWidth;
    const y = (1 - (v.y * 0.5 + 0.5)) * innerHeight;
    this.crosshair.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%,-50%)`;
  }

  update(dt: number): void {
    this.fxAndShake(dt);
    if (this.phase === 'off' || this.frozen) return;
    this.syncCrosshair();
    const boss = this.arena.boss;
    const pp = this.player.pos;

    // ── the SMG: fires where the crosshair looks, at all times ──
    if (this.firing && this.phase !== 'audited' && this.phase !== 'victory') {
      // the hero squares up to the camera's heading while shooting
      const camDir = this.player.camera.getWorldDirection(this.tmpA);
      const wantRot = Math.atan2(camDir.x, camDir.z);
      this.player.rot += (((wantRot - this.player.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 12);

      this.fireAcc += dt * SMG_RPS;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        const hitMark = this.aimRay(this.tmpB);
        this.fx.tracer(this.gunMuzzle(this.tmpA), this.tmpB);
        if (hitMark) this.damageBoss(SMG_DMG);
      }
    } else this.fireAcc = 0;

    switch (this.phase) {
      case 'countdown': {
        this.t -= dt;
        boss.ragePower = 1 - Math.max(0, this.t) / COUNTDOWN;
        this.setBanner(`MARK THE STARTUP ENEMY IS GETTING MAD — ${Math.max(1, Math.ceil(this.t))}`);
        if (this.t <= 0) {
          boss.setMode('fight');
          this.setBanner('THE ROAST COMMENCES');
          setTimeout(() => { if (this.phase !== 'countdown') this.banner.style.display = 'none'; }, 1400);
          this.shakeT = 0.4;
          this.phase = 'aim';
          this.t = AIM_T;
          this.aimPoint.set(pp.x, IRS_ARENA.floorY, pp.z);
        }
        break;
      }
      case 'aim': {
        this.t -= dt;
        boss.facePoint(pp.x, pp.z, dt, 7);
        // the laser hunts you with a little lag — juking works — but it
        // STOPS at cover: duck behind a pillar and it paints the pillar,
        // and that is where the rocket will land.
        const muzzle = boss.muzzleWorld(this.tmpA);
        this.clipAtPillars(muzzle, this.tmpB.set(pp.x, IRS_ARENA.floorY, pp.z), this.tmpC);
        this.aimPoint.x += (this.tmpC.x - this.aimPoint.x) * Math.min(1, dt * 3.2);
        this.aimPoint.z += (this.tmpC.z - this.aimPoint.z) * Math.min(1, dt * 3.2);
        this.aimPoint.y = IRS_ARENA.floorY;
        this.fx.laserShow(muzzle, this.aimPoint, false, this.t);
        if (this.t <= 0) {
          this.lockedPoint.copy(this.aimPoint);
          this.phase = 'lock';
          this.t = LOCK_T;
        }
        break;
      }
      case 'lock': {
        this.t -= dt;
        this.fx.laserShow(boss.muzzleWorld(this.tmpA), this.lockedPoint, true, this.t);
        if (this.t <= 0) {
          this.fx.laserHide();
          boss.recoil();
          this.fx.rocketLaunch(boss.muzzleWorld(this.tmpA), this.lockedPoint, FLIGHT_T);
          this.shakeT = Math.max(this.shakeT, 0.18);
          this.phase = 'flight';
        }
        break;
      }
      case 'flight':
        boss.facePoint(pp.x, pp.z, dt, 3);
        // impact is detected by fx.update() in fxAndShake — nothing to time here
        break;
      case 'cooldown': {
        this.t -= dt;
        if (this.repositionTo) {
          if (boss.walkToward(this.repositionTo.x, this.repositionTo.z, dt)) this.repositionTo = null;
        } else boss.facePoint(pp.x, pp.z, dt, 5);
        if (this.t <= 0) {
          this.phase = 'aim';
          this.t = AIM_T;
          this.aimPoint.set(pp.x, IRS_ARENA.floorY, pp.z);
        }
        break;
      }
      case 'victory':
      case 'audited':
        break;
    }
  }

  private fxAndShake(dt: number): void {
    const landed = this.fx.update(dt);
    if (landed && this.phase === 'flight') {
      this.fx.explode(this.lockedPoint);
      this.shakeT = Math.max(this.shakeT, 0.5);
      const d = Math.hypot(this.player.pos.x - this.lockedPoint.x, this.player.pos.z - this.lockedPoint.z);
      if (d < BLAST_R && !this.coverBetween(this.lockedPoint, this.player.pos)) {
        this.damagePlayer(BLAST_MIN + (BLAST_DMG - BLAST_MIN) * (1 - d / BLAST_R));
      }
      // sometimes he relocates before the next shot
      this.repositionTo = Math.random() < 0.45
        ? { x: IRS_ARENA.cx + (Math.random() - 0.5) * 18, z: IRS_ARENA.cz - 2 - Math.random() * 9 }
        : null;
      this.phase = 'cooldown';
      this.t = COOLDOWN_T;
    }
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeT * 0.5;
      this.player.camera.position.x += (Math.random() - 0.5) * k;
      this.player.camera.position.y += (Math.random() - 0.5) * k;
    }
  }
}
