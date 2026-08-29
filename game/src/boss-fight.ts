import * as THREE from 'three';
import { IRS_ARENA, PILLARS, shadedBox, type IrsArena } from './arena';
import { FightFx } from './fight-fx';
import type { Player } from './player';

/**
 * The audit, phase one: the shooter. Ten seconds of IRS Mark getting mad,
 * then the bazooka loop — a laser that tracks you, a lock, a rocket you have
 * time to not be under, and an explosion that respects cover. You hold Space
 * and your SMG argues back the whole time.
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
const MARK_HP = 520;
const SMG_RPS = 11;
const SMG_DMG = 1.3;

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
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  // HUD
  private readonly banner: HTMLDivElement;
  private readonly myBar: HTMLDivElement;
  private readonly myFill: HTMLDivElement;
  private readonly markBar: HTMLDivElement;
  private readonly markFill: HTMLDivElement;
  private readonly vignette: HTMLDivElement;

  constructor(
    scene: THREE.Scene,
    private readonly arena: IrsArena,
    private readonly player: Player,
    private readonly hooks: { onAudited: () => void; toast: (msg: string, emoji: string) => void },
  ) {
    scene.add(this.fx.group);

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
      'font:900 34px system-ui;color:#fff;text-shadow:0 3px 0 #28304a,0 0 26px rgba(255,74,61,.7);display:none;');
    const barCss = (bottom: string, w: string) =>
      `position:fixed;${bottom}left:50%;transform:translateX(-50%);width:${w};height:16px;z-index:30;` +
      'background:#1d1f2a;border:2px solid #2e3140;border-radius:9px;overflow:hidden;display:none;pointer-events:none;';
    this.myBar = el(barCss('bottom:26px;', '280px'));
    this.myFill = document.createElement('div');
    this.myFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(#aee3c8,#7cc474);transition:width .12s';
    this.myBar.append(this.myFill);
    this.markBar = el(barCss('top:56px;', '420px'));
    this.markFill = document.createElement('div');
    this.markFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(#ff9d96,#e4574f);transition:width .12s';
    this.markBar.append(this.markFill);
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;top:-24px;left:0;right:0;text-align:center;font:800 13px system-ui;color:#fffdf6;text-shadow:0 2px 0 #28304a';
    label.textContent = 'IRS MARK — W-2 ENFORCER';
    this.markBar.append(label);
    this.vignette = el(
      'position:fixed;inset:0;pointer-events:none;z-index:29;opacity:0;transition:opacity .35s;' +
      'box-shadow:inset 0 0 140px 50px rgba(228,60,45,.55);');
  }

  get active(): boolean { return this.phase !== 'off'; }

  begin(): void {
    this.phase = 'countdown';
    this.t = COUNTDOWN;
    this.myHp = PLAYER_HP;
    this.markHp = MARK_HP;
    this.firing = false;
    this.gun.visible = true;
    this.arena.boss.setMode('rage');
    this.banner.style.display = this.myBar.style.display = this.markBar.style.display = 'block';
    this.syncBars();
  }

  reset(): void {
    this.phase = 'off';
    this.frozen = false;
    this.firing = false;
    this.gun.visible = false;
    this.fx.clear();
    this.arena.boss.setMode('idle');
    this.arena.boss.ragePower = 0;
    this.banner.style.display = this.myBar.style.display = this.markBar.style.display = 'none';
    this.vignette.style.opacity = '0';
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

  private win(): void {
    this.phase = 'victory';
    this.fx.laserHide();
    this.fx.rocketAbort();
    this.arena.boss.setMode('defeat');
    this.fx.confetti();
    this.banner.textContent = 'AUDIT CANCELLED — REFUND APPROVED';
    this.banner.style.textShadow = '0 3px 0 #28304a, 0 0 26px rgba(255,217,119,.8)';
    this.hooks.toast('Mark drops the bazooka. "…your paperwork is in order."', '💸');
    setTimeout(() => { this.banner.style.display = 'none'; }, 4200);
  }

  private lose(): void {
    this.phase = 'audited';
    this.fx.laserHide();
    this.fx.rocketAbort();
    this.fx.gibs(this.player.pos);
    this.player.view.root.visible = false;
    this.banner.textContent = 'YOU HAVE BEEN AUDITED';
    this.banner.style.display = 'block';
    setTimeout(() => this.hooks.onAudited(), 1300);
  }

  update(dt: number): void {
    this.fxAndShake(dt);
    if (this.phase === 'off' || this.frozen) return;
    const boss = this.arena.boss;
    const pp = this.player.pos;

    // the SMG argues at all times — even during the countdown
    if (this.firing && this.phase !== 'audited' && this.phase !== 'victory') {
      this.fireAcc += dt * SMG_RPS;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        const from = this.tmpA.copy(pp).add(this.gunMuzzleOffset());
        const to = this.tmpB.copy(boss.root.position);
        to.y += 1.7;
        to.x += (Math.random() - 0.5) * 0.5;
        to.z += (Math.random() - 0.5) * 0.5;
        this.fx.tracer(from, to);
        this.damageBoss(SMG_DMG);
      }
      // face Mark while firing, so the tracers come off the barrel honestly
      const d = Math.atan2(boss.root.position.x - pp.x, boss.root.position.z - pp.z);
      this.player.rot += (((d - this.player.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10);
    }

    switch (this.phase) {
      case 'countdown': {
        this.t -= dt;
        boss.ragePower = 1 - Math.max(0, this.t) / COUNTDOWN;
        this.banner.textContent = `IRS MARK IS GETTING MAD — ${Math.max(1, Math.ceil(this.t))}`;
        if (this.t <= 0) {
          boss.setMode('fight');
          this.banner.textContent = 'AUDIT COMMENCED';
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
        // the laser hunts you with a little lag — juking works
        this.aimPoint.x += (pp.x - this.aimPoint.x) * Math.min(1, dt * 3.2);
        this.aimPoint.z += (pp.z - this.aimPoint.z) * Math.min(1, dt * 3.2);
        this.aimPoint.y = IRS_ARENA.floorY;
        this.fx.laserShow(boss.muzzleWorld(this.tmpA), this.aimPoint, false, this.t);
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

  /** True when a pillar stands between the blast and the player: full cover. */
  private coverBetween(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return false;
    for (const p of PILLARS) {
      const t = THREE.MathUtils.clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / len2, 0, 1);
      const qx = a.x + dx * t - p.x, qz = a.z + dz * t - p.z;
      if (qx * qx + qz * qz < (p.r - 0.15) ** 2) return true;
    }
    return false;
  }

  private gunMuzzleOffset(): THREE.Vector3 {
    // gun sits on the right hip; muzzle pokes forward of the hero's facing
    const r = this.player.rot;
    return this.tmpB.set(
      Math.cos(r) * 0.32 + Math.sin(r) * 0.5,
      0.9,
      -Math.sin(r) * 0.32 + Math.cos(r) * 0.5,
    ).clone();
  }
}
