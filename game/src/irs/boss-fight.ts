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
const MARK_HP = 1000;
const REWARD_DMG = MARK_HP / 5;   // five correct answers end him — SMG chip is a bonus
const WRONG_DMG = PLAYER_HP / 5;  // five wrong answers end you
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
  /** Question-round cinematics: whose rocket is in the air while frozen. */
  private cine: 'none' | 'playerShot' | 'markShot' = 'none';
  private cineTarget = new THREE.Vector3();

  private qTimer: ReturnType<typeof setInterval> | null = null;
  private readonly launcher: THREE.Group;
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
  private readonly qPanel: HTMLDivElement;
  private readonly qText: HTMLDivElement;
  private readonly qInput: HTMLInputElement;
  private readonly qGo: HTMLButtonElement;
  private readonly qClock: HTMLDivElement;

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

    // the verdict launcher: shoulder tube the hero produces from nowhere for
    // exactly one very satisfying shot per correct answer
    this.launcher = new THREE.Group();
    const lm = new THREE.MeshStandardMaterial({ color: 0x3a5a40, roughness: 0.6 });
    const lpart = (w: number, h: number, d: number, x: number, y: number, z: number, m = lm) => {
      const b = new THREE.Mesh(shadedBox(w, h, d), m);
      b.position.set(x, y, z);
      this.launcher.add(b);
      return b;
    };
    lpart(0.2, 0.2, 1.1, 0, 0, 0);                                   // tube
    lpart(0.26, 0.26, 0.2, 0, 0, 0.56);                              // bell
    lpart(0.07, 0.14, 0.07, 0, -0.16, 0.1);                          // grip
    lpart(0.05, 0.05, 0.3, 0, 0.13, 0,
      new THREE.MeshStandardMaterial({ color: 0xffd977, roughness: 0.4 })); // brass sight
    this.launcher.position.set(0.34, 1.16, 0);
    this.launcher.visible = false;
    player.view.root.add(this.launcher);

    // the audit question panel
    this.qPanel = el(
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(520px,92vw);z-index:35;' +
      'background:#fffdf6;border:3px solid #2e3140;border-radius:18px;padding:18px 20px 16px;display:none;' +
      'box-shadow:0 8px 0 rgba(53,49,63,.3);font-family:"Baloo 2",system-ui;');
    this.qPanel.innerHTML =
      '<div style="font:900 13px inherit;color:#e4574f;letter-spacing:.08em">AUDIT QUESTION</div>';
    this.qText = document.createElement('div');
    this.qText.style.cssText = 'font:700 17px inherit;color:#35313f;margin:8px 0 12px;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';
    this.qInput = document.createElement('input');
    this.qInput.style.cssText =
      'flex:1;border:2px solid #2e3140;border-radius:10px;padding:8px 12px;font:700 15px inherit;' +
      'background:#fff;color:#35313f;min-width:0;';
    this.qInput.placeholder = 'your answer…';
    this.qGo = document.createElement('button');
    this.qGo.textContent = 'ANSWER';
    this.qGo.style.cssText =
      'border:none;border-radius:10px;padding:8px 16px;font:900 14px inherit;cursor:pointer;' +
      'background:#e4574f;color:#fffdf6;box-shadow:0 3px 0 rgba(53,49,63,.25);';
    row.append(this.qInput, this.qGo);
    this.qClock = document.createElement('div');
    this.qClock.style.cssText =
      'height:8px;margin-top:12px;border-radius:5px;background:#e8e4da;overflow:hidden;';
    this.qClock.innerHTML = '<div style="height:100%;width:100%;background:linear-gradient(90deg,#ffd977,#e4574f)"></div>';
    this.qPanel.append(this.qText, row, this.qClock);
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
    this.cine = 'none';
    this.launcher.visible = false;
    this.qPanel.style.display = 'none';
    if (this.qTimer) { clearInterval(this.qTimer); this.qTimer = null; }
    delete document.body.dataset.typing;
    this.player.view.root.visible = true;
  }

  setFiring(on: boolean): void { this.firing = on; }

  // ── question rounds (driven by the encounter via the hub) ────────────────

  /** True while the shooter is actually exchanging fire. */
  get inCombat(): boolean {
    return this.phase === 'aim' || this.phase === 'lock' || this.phase === 'flight' || this.phase === 'cooldown';
  }

  /**
   * Freeze THIS fight for a question — never mid-rocket, so nothing lands
   * during the exam. Only the local player and their Mark pause; the hub,
   * the city, and everyone else's fights run on.
   */
  tryFreezeForRound(): boolean {
    if (this.frozen || this.cine !== 'none') return false;
    if (this.phase !== 'aim' && this.phase !== 'lock' && this.phase !== 'cooldown') return false;
    this.frozen = true;
    this.firing = false;
    this.fx.laserHide();
    this.say('HOLD YOUR FIRE. Audit question.');
    return true;
  }

  /** Mark's voice — the encounter wires this to the town's bubble system,
   *  so he talks exactly like every other citizen: anchored to his head. */
  say: (text: string) => void = () => {};

  /** Put the question on screen; onSubmit fires exactly once (empty = timeout). */
  askQuestion(text: string, deadlineS: number, onSubmit: (answer: string) => void): void {
    this.qText.textContent = text;
    this.qInput.value = '';
    this.qInput.disabled = this.qGo.disabled = false;
    this.qPanel.style.display = 'block';
    document.body.dataset.typing = '1'; // movement and fire keys stand down
    const bar = this.qClock.firstElementChild as HTMLElement;
    bar.style.width = '100%';
    const t0 = Date.now();
    let sent = false;
    const submit = (answer: string) => {
      if (sent) return;
      sent = true;
      if (this.qTimer) { clearInterval(this.qTimer); this.qTimer = null; }
      this.qInput.disabled = this.qGo.disabled = true;
      this.qText.textContent = 'Mark is auditing your answer…';
      onSubmit(answer);
    };
    this.qGo.onclick = () => submit(this.qInput.value);
    this.qInput.onkeydown = (e) => { if (e.key === 'Enter') submit(this.qInput.value); };
    if (this.qTimer) clearInterval(this.qTimer);
    this.qTimer = setInterval(() => {
      const left = deadlineS * 1000 - (Date.now() - t0);
      bar.style.width = `${Math.max(0, (left / (deadlineS * 1000)) * 100)}%`;
      if (left <= 0) submit(this.qInput.value); // whatever is typed, time is up
    }, 100);
    this.qInput.focus();
  }

  /** The verdict lands: flash it, then the rocket cinematic settles the score. */
  applyVerdict(correct: boolean, expected: string, line: string): void {
    this.qText.textContent = correct ? '✓ CORRECT' : `✗ WRONG — the answer: ${expected}`;
    this.qText.style.color = correct ? '#4e9a06' : '#e4574f';
    this.say(line);
    setTimeout(() => {
      this.qPanel.style.display = 'none';
      this.qText.style.color = '#35313f';
      // dataset.typing stays set: you HOLD STILL while the verdict rocket
      // flies, yours or his — released when it lands (fxAndShake).
      const boss = this.arena.boss.root.position;
      if (correct) {
        // your turn: the launcher appears, and Mark learns some respect
        this.gun.visible = false;
        this.launcher.visible = true;
        const d = Math.atan2(boss.x - this.player.pos.x, boss.z - this.player.pos.z);
        this.player.rot = d;
        this.cineTarget.set(boss.x, IRS_ARENA.floorY + 1.4, boss.z);
        this.cine = 'playerShot';
        this.fx.rocketLaunch(
          this.tmpA.set(this.player.pos.x + Math.sin(d) * 0.5, this.player.pos.y + 1.2, this.player.pos.z + Math.cos(d) * 0.5),
          this.cineTarget, 1.15);
      } else {
        this.arena.boss.facePoint(this.player.pos.x, this.player.pos.z, 1, 100);
        this.arena.boss.recoil();
        this.cineTarget.set(this.player.pos.x, IRS_ARENA.floorY, this.player.pos.z);
        this.cine = 'markShot';
        this.fx.rocketLaunch(this.arena.boss.muzzleWorld(this.tmpA), this.cineTarget, 1.15);
      }
    }, 1400);
  }

  /** The hub never answered (no server, no question): resume the shooter. */
  cancelRound(): void {
    this.qPanel.style.display = 'none';
    delete document.body.dataset.typing;
    if (this.qTimer) { clearInterval(this.qTimer); this.qTimer = null; }
    if (this.cine === 'none') this.frozen = false;
  }

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
    if (landed && this.cine !== 'none') {
      this.fx.explode(this.cineTarget);
      this.shakeT = Math.max(this.shakeT, 0.55);
      if (this.cine === 'playerShot') {
        this.damageBoss(REWARD_DMG);
        this.arena.boss.flinch();
      } else {
        this.damagePlayer(WRONG_DMG);
      }
      this.cine = 'none';
      this.launcher.visible = false;
      delete document.body.dataset.typing; // the shot landed; you may move again
      if (this.active) this.gun.visible = true;
      // a beat to admire the crater, then the shooter resumes
      setTimeout(() => { if (this.active) this.frozen = false; }, 700);
      return;
    }
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
