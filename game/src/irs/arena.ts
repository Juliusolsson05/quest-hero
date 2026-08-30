import * as THREE from 'three';
import { bakeStatics } from '../bake';
import { angleToward } from '../util';
import { shadedBox as shadedVoxel } from '../voxel';
import { C } from '../world';

/**
 * The IRS audit chamber: a domed rotunda far off the island grid — past the
 * fog, so neither world can see the other — and IRS Mark, the taxcollector
 * who lives in it. This file owns the set and Mark's body; the fight itself
 * (countdown, bazooka, damage) lives in boss-fight.ts and drives Mark through
 * the hooks at the bottom of the Taxcollector class.
 */

/** Mark's whole personality, for when the MCP server gives him a voice. */
export const MARK_LINE = 'You are NEVER going to make it as a founder';

const HALF = 16;
export const IRS_ARENA = {
  cx: 160,
  cz: -60,
  floorY: 1,
  /** Where the player materialises: just inside the south door. */
  entrance: { x: 160, z: -60 + HALF - 2.6 },
  bounds: {
    minX: 160 - HALF + 0.7, maxX: 160 + HALF - 0.7,
    minZ: -60 - HALF + 0.7, maxZ: -60 + HALF - 0.7,
    y: 1,
    blockers: [] as { x: number; z: number; r: number }[],
  },
};

/** Six fat columns you can genuinely hide behind — they block your feet
 *  (player collision) and the blast (line-of-sight in boss-fight.ts). */
export const PILLARS = [0, 60, 120, 180, 240, 300].map((deg) => ({
  x: IRS_ARENA.cx + Math.cos((deg * Math.PI) / 180) * 8.5,
  z: IRS_ARENA.cz + Math.sin((deg * Math.PI) / 180) * 8.5,
  r: 1.35,
}));
IRS_ARENA.bounds.blockers = PILLARS;

// The chamber shades flatter than the city — fluorescent gloom, no sun.
// Exported: boss-fight.ts and fight-fx.ts build their props with it.
const SHADES = { top: 1, bottom: 0.62, sideX: 0.82, sideZ: 0.82 };
export function shadedBox(w = 1, h = 1, d = 1): THREE.BoxGeometry {
  return shadedVoxel(w, h, d, SHADES);
}

function textPlane(text: string, fg: string, bg: string, w: number, h: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = Math.round(512 * (h / w));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  let px = Math.round(canvas.height * 0.62);
  ctx.font = `900 ${px}px system-ui, sans-serif`;
  while (px > 8 && ctx.measureText(text).width > canvas.width * 0.94) {
    px -= 2;
    ctx.font = `900 ${px}px system-ui, sans-serif`;
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + canvas.height * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
}

// ── IRS Mark ────────────────────────────────────────────────────────────────

export type BossMode = 'idle' | 'rage' | 'fight' | 'defeat';
type IdleState = 'pace' | 'consider' | 'neckcrack';

export class Taxcollector {
  readonly root = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly torso: THREE.Group;
  private readonly bazooka: THREE.Group;
  private readonly tintable: THREE.MeshStandardMaterial[] = [];

  mode: BossMode = 'idle';
  private state: IdleState = 'consider';
  private stateT = 1.5;
  private waypoint = 0;
  private rot = Math.PI; // facing the door when you walk in
  private t = 0;
  private bazookaScale = 0;
  private recoilT = 0;
  private flinchT = 0;
  private kneelT = 0;
  private walkBob = 0;

  /** North half of the hall — he never crowds the exit. */
  private readonly route = [
    { x: IRS_ARENA.cx - 10, z: IRS_ARENA.cz - 9 },
    { x: IRS_ARENA.cx + 10, z: IRS_ARENA.cz - 9 },
    { x: IRS_ARENA.cx + 10, z: IRS_ARENA.cz - 2 },
    { x: IRS_ARENA.cx - 10, z: IRS_ARENA.cz - 2 },
    { x: IRS_ARENA.cx, z: IRS_ARENA.cz - 11.5 },
  ];

  constructor() {
    const mat = (c: number) => {
      const m = new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.85 });
      this.tintable.push(m);
      return m;
    };
    const mk = (parent: THREE.Object3D, w: number, h: number, d: number, c: number,
                x: number, y: number, z: number, basic = false) => {
      const m = new THREE.Mesh(
        shadedBox(w, h, d),
        basic ? new THREE.MeshBasicMaterial({ color: c }) : mat(c),
      );
      m.position.set(x, y, z);
      m.castShadow = !basic;
      parent.add(m);
      return m;
    };

    const SKIN = 0xe8bd98, SHIRT = 0xf6f3ea, SLACKS = 0x3a3f4d, TIE = 0x28304a;

    // slacks + shoes — wide stance
    mk(this.root, 0.5, 0.2, 0.66, 0x23252e, -0.4, 0.1, 0.04);
    mk(this.root, 0.5, 0.2, 0.66, 0x23252e, 0.4, 0.1, 0.04);
    mk(this.root, 0.46, 0.85, 0.5, SLACKS, -0.4, 0.62, 0);
    mk(this.root, 0.46, 0.85, 0.5, SLACKS, 0.4, 0.62, 0);
    mk(this.root, 1.3, 0.28, 0.56, 0x2c2f3a, 0, 1.1, 0);      // belt
    mk(this.root, 0.16, 0.14, 0.06, C.gold, 0, 1.1, 0.29);    // buckle

    // the torso: a refrigerator in a dress shirt
    this.torso = new THREE.Group();
    this.torso.position.y = 1.24;
    this.root.add(this.torso);
    mk(this.torso, 1.62, 1.05, 0.86, SHIRT, 0, 0.52, 0);
    mk(this.torso, 1.86, 0.34, 0.95, SHIRT, 0, 1.06, 0);      // trapezius shelf
    mk(this.torso, 0.18, 0.8, 0.05, TIE, 0, 0.5, 0.46);       // the tie
    mk(this.torso, 0.26, 0.14, 0.05, TIE, 0, 0.98, 0.46);     // knot
    mk(this.torso, 0.3, 0.1, 0.04, C.gold, -0.55, 0.9, 0.45); // badge
    const chest = textPlane('ENEMY', '#28304a', '#f6f3ea', 0.62, 0.3);
    chest.position.set(0.42, 0.72, 0.44);
    this.torso.add(chest);

    // arms: shoulder-pivot groups so they can swing, tap, and brace
    const arm = (side: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(side * 1.05, 2.28, 0);
      mk(g, 0.42, 0.62, 0.46, SHIRT, 0, -0.28, 0);            // rolled sleeve
      mk(g, 0.36, 0.62, 0.4, SKIN, 0, -0.85, 0.02);           // forearm
      mk(g, 0.4, 0.24, 0.42, SKIN, 0, -1.2, 0.04);            // fist
      this.root.add(g);
      return g;
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    const clipboard = mk(this.armL, 0.06, 0.5, 0.38, 0x8f6a44, -0.06, -1.22, 0.2);
    clipboard.rotation.x = -0.3;
    const paper = mk(this.armL, 0.02, 0.4, 0.3, 0xfdfaf2, -0.09, -1.21, 0.2, true);
    paper.rotation.x = -0.3;

    // small head on a big frame — flat-top, shades. The neck seats it into
    // the trapezius shelf instead of hovering over it.
    mk(this.root, 0.32, 0.3, 0.32, SKIN, 0, 2.5, 0);
    this.head = new THREE.Group();
    this.head.position.y = 2.58;
    this.root.add(this.head);
    mk(this.head, 0.56, 0.5, 0.54, SKIN, 0, 0.25, 0);
    mk(this.head, 0.62, 0.16, 0.6, 0x2c2833, 0, 0.55, 0);     // flat-top
    mk(this.head, 0.5, 0.12, 0.06, 0x14151c, 0, 0.32, 0.28, true); // shades
    mk(this.head, 0.1, 0.05, 0.04, SKIN, 0, 0.18, 0.29);      // stern nose
    mk(this.head, 0.34, 0.05, 0.03, 0x9c6f52, 0, 0.04, 0.28); // the frown

    // ── the bazooka: shoulder tube, hidden until the countdown ends ──
    this.bazooka = new THREE.Group();
    this.bazooka.position.set(0.72, 2.62, 0.1);
    const OLIVE = 0x4c5a3f;
    mk(this.bazooka, 0.4, 0.4, 1.9, OLIVE, 0, 0, 0);          // the tube
    mk(this.bazooka, 0.46, 0.46, 0.3, 0x39452f, 0, 0, 0.95);  // muzzle bell
    mk(this.bazooka, 0.46, 0.46, 0.22, 0x39452f, 0, 0, -0.85);// venturi
    mk(this.bazooka, 0.08, 0.08, 0.5, C.gold, 0, 0.26, 0.3);  // brass rail
    mk(this.bazooka, 0.12, 0.22, 0.12, 0x2c2f3a, 0.1, -0.3, 0.28); // grip
    const stencil = textPlane('DENIED', '#ffd977', '#4c5a3f', 0.5, 0.24);
    stencil.position.set(0.21, 0, -0.2);
    stencil.rotation.y = Math.PI / 2;
    this.bazooka.add(stencil);
    this.bazooka.scale.setScalar(0.001);
    this.bazooka.visible = false;
    this.root.add(this.bazooka);

    this.root.scale.setScalar(0.92); // ~2.6 tall on a 1.5-tall street

    // Merge the suit. The groups the fight animates stay live; the baked
    // materials replace the per-part ones in `tintable`, so the hit-flash
    // tints the whole silhouette exactly as before — through ~6 materials
    // instead of ~30. (The ENEMY chest plane and DENIED stencil carry canvas
    // textures, which bakeStatics leaves alone automatically.)
    this.tintable.length = 0;
    const groups = [this.torso, this.head, this.armL, this.armR, this.bazooka];
    for (const baked of [
      ...bakeStatics(this.root, groups, { privateMaterials: true }),
      ...groups.flatMap((g) => bakeStatics(g, [], { privateMaterials: true })),
    ]) {
      const m = baked.material as THREE.MeshStandardMaterial;
      if (m.type === 'MeshStandardMaterial') this.tintable.push(m);
    }
  }

  // ── fight hooks (driven by boss-fight.ts) ─────────────────────────────────

  /** World position of the bazooka muzzle — where the laser starts. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.bazooka.localToWorld(out.set(0, 0, 1.05));
  }

  setMode(m: BossMode): void {
    this.mode = m;
    if (m === 'idle') {
      this.state = 'consider';
      this.stateT = 1.5;
      this.bazooka.visible = false;
      this.bazookaScale = 0;
      this.kneelT = 0;
      this.root.rotation.x = 0;
      this.root.position.y = IRS_ARENA.floorY;
    }
    if (m === 'fight') this.bazooka.visible = true;
  }

  facePoint(x: number, z: number, dt: number, rate = 6): void {
    const p = this.root.position;
    this.rot = angleToward(this.rot, Math.atan2(x - p.x, z - p.z), dt * rate);
  }

  /** Walk toward a point at boss pace; true when arrived. */
  walkToward(x: number, z: number, dt: number): boolean {
    const p = this.root.position;
    if (Math.hypot(x - p.x, z - p.z) < 0.5) { this.walkBob = 0; return true; }
    this.facePoint(x, z, dt, 6);
    p.x += Math.sin(this.rot) * 1.6 * dt;
    p.z += Math.cos(this.rot) * 1.6 * dt;
    this.walkBob = Math.min(1, this.walkBob + dt * 5);
    return false;
  }

  recoil(): void { this.recoilT = 0.35; }
  flinch(): void { this.flinchT = Math.max(this.flinchT, 0.09); }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.t += dt;
    const p = this.root.position;

    // hit flash: every shirt/skin material blinks toward red
    this.flinchT = Math.max(0, this.flinchT - dt);
    const tint = this.flinchT > 0 ? 0.55 : 0;
    for (const m of this.tintable) m.emissive.setRGB(tint, tint * 0.12, tint * 0.1);

    if (this.mode === 'rage') {
      // the countdown: building fury — shaking fists, stomps, a bounce that
      // gets angrier as the timer runs down (boss-fight scales via ragePower)
      const k = this.ragePower;
      this.facePoint(playerPos.x, playerPos.z, dt, 8);
      this.torso.rotation.z = Math.sin(this.t * (8 + k * 14)) * 0.04 * (0.4 + k);
      this.head.rotation.z = Math.sin(this.t * (9 + k * 16)) * 0.06 * (0.4 + k);
      this.armL.rotation.x = -2.4 + Math.sin(this.t * (10 + k * 12)) * 0.2;   // fists up
      this.armR.rotation.x = -2.4 + Math.cos(this.t * (10 + k * 12)) * 0.2;
      p.y = IRS_ARENA.floorY + Math.abs(Math.sin(this.t * (3 + k * 6))) * 0.1 * (0.3 + k);
      this.root.rotation.y = this.rot;
      return;
    }

    if (this.mode === 'fight') {
      // bazooka scales in with a pop
      this.bazookaScale = Math.min(1, this.bazookaScale + dt * 3.2);
      const s = 1 + Math.sin(this.bazookaScale * Math.PI) * 0.35;
      this.bazooka.scale.setScalar(this.bazookaScale * s);
      // right arm braces the tube, left arm forward for balance
      this.armR.rotation.x = -1.9;
      this.armL.rotation.x = -0.5 + Math.sin(this.t * 2.2) * 0.05;
      // recoil kick
      this.recoilT = Math.max(0, this.recoilT - dt);
      const kick = this.recoilT > 0 ? Math.sin((this.recoilT / 0.35) * Math.PI) : 0;
      this.torso.rotation.x = -kick * 0.22;
      this.bazooka.position.z = 0.1 - kick * 0.3;
      // gait bob while repositioning, breathing while planted
      const bob = this.walkBob;
      p.y = IRS_ARENA.floorY + Math.abs(Math.sin(this.t * 4.6)) * 0.06 * bob;
      this.torso.rotation.z = Math.sin(this.t * 4.6) * 0.04 * bob;
      this.walkBob = Math.max(0, this.walkBob - dt * 2.5);
      this.head.rotation.x = Math.sin(this.t * 1.6) * 0.03;
      this.root.rotation.y = this.rot;
      return;
    }

    if (this.mode === 'defeat') {
      // to his knees: the tube clatters off, the frame sinks and tips
      this.kneelT = Math.min(1, this.kneelT + dt * 1.4);
      const e = 1 - (1 - this.kneelT) ** 3;
      p.y = IRS_ARENA.floorY - 0.52 * e;
      this.root.rotation.x = 0.34 * e;
      this.armL.rotation.x = -0.2 * e;
      this.armR.rotation.x = -0.2 * e;
      this.head.rotation.x = 0.5 * e + Math.sin(this.t * 1.1) * 0.02;
      this.torso.rotation.x = 0.1 * e;
      this.torso.rotation.z = 0;
      this.root.rotation.y = this.rot;
      return;
    }

    // ── idle life (pre-fight, and the state he returns to) ──
    this.stateT -= dt;
    const faceToward = (tx: number, tz: number, rate: number) => this.facePoint(tx, tz, dt, rate);

    if (this.state === 'pace') {
      const wp = this.route[this.waypoint];
      const d = Math.hypot(wp.x - p.x, wp.z - p.z);
      if (d < 0.4) {
        this.state = 'consider';
        this.stateT = 1.4 + Math.random() * 2.2;
      } else {
        faceToward(wp.x, wp.z, 6);
        const SPEED = 1.25; // unhurried; he knows you can't leave with unpaid taxes
        p.x += Math.sin(this.rot) * SPEED * dt;
        p.z += Math.cos(this.rot) * SPEED * dt;
        p.y = IRS_ARENA.floorY + Math.abs(Math.sin(this.t * 4.4)) * 0.055;
        this.torso.rotation.z = Math.sin(this.t * 4.4) * 0.05;
        this.armL.rotation.x = Math.sin(this.t * 4.4) * 0.28;
        this.armR.rotation.x = -Math.sin(this.t * 4.4) * 0.28;
      }
    } else if (this.state === 'consider') {
      faceToward(playerPos.x, playerPos.z, 4);
      p.y += (IRS_ARENA.floorY - p.y) * Math.min(1, dt * 8);
      this.torso.rotation.z *= 1 - Math.min(1, dt * 6);
      this.armL.rotation.x += (-0.55 - this.armL.rotation.x) * Math.min(1, dt * 5); // clipboard up
      this.armR.rotation.x = Math.max(0, Math.sin(this.t * 9)) * 0.16 - 0.2;        // tap tap
      if (this.stateT <= 0) {
        if (Math.random() < 0.3) { this.state = 'neckcrack'; this.stateT = 1.1; }
        else {
          this.state = 'pace';
          this.waypoint = (this.waypoint + 1 + Math.floor(Math.random() * 2)) % this.route.length;
        }
      }
    } else { // neckcrack
      this.head.rotation.z = Math.sin((1.1 - this.stateT) * 8) * 0.28;
      if (this.stateT <= 0) {
        this.head.rotation.z = 0;
        this.state = 'pace';
        this.waypoint = (this.waypoint + 1) % this.route.length;
      }
    }

    this.torso.scale.y = 1 + Math.sin(this.t * 1.8) * 0.012;
    this.head.rotation.x = Math.sin(this.t * 1.6) * 0.03;
    this.root.rotation.y = this.rot;
  }

  /** 0..1, set by boss-fight during the countdown; scales the fury. */
  ragePower = 0;
}

// ── the chamber ─────────────────────────────────────────────────────────────

export class IrsArena {
  readonly group = new THREE.Group();
  readonly boss = new Taxcollector();
  private readonly exitPos: THREE.Vector3;

  constructor() {
    const { cx, cz, floorY } = IRS_ARENA;
    const mat = (c: number, rough = 0.9) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: rough });
    const mk = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, basic = false) => {
      const m = new THREE.Mesh(
        shadedBox(w, h, d),
        basic ? new THREE.MeshBasicMaterial({ color: c }) : mat(c),
      );
      m.position.set(x, y, z);
      m.receiveShadow = !basic;
      this.group.add(m);
      return m;
    };

    const W = HALF * 2 + 1;
    const FLOOR = 0x3b3e4a, WALL = 0x474b5c, TRIM = 0x2e3140;

    mk(W, 0.5, W, FLOOR, cx, floorY - 0.25, cz);                       // floor slab
    mk(2.6, 0.03, 26, 0x8f3b3b, cx, floorY + 0.02, cz + 1.5);         // the red carpet to your audit
    mk(W, 8, 0.6, WALL, cx, floorY + 4, cz - HALF - 0.3);             // north wall
    mk(W, 8, 0.6, WALL, cx, floorY + 4, cz + HALF + 0.3);             // south wall
    mk(0.6, 8, W, WALL, cx - HALF - 0.3, floorY + 4, cz);             // west wall
    mk(0.6, 8, W, WALL, cx + HALF + 0.3, floorY + 4, cz);             // east wall
    mk(W + 1.2, 0.5, W + 1.2, TRIM, cx, floorY + 8.25, cz);           // ceiling ring

    // ── the dome: a low-poly rotunda bulging up through the ceiling ──
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(12.5, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x262a38, side: THREE.BackSide, flatShading: true, roughness: 0.95,
      }),
    );
    dome.scale.y = 0.72;
    dome.position.set(cx, floorY + 8.2, cz);
    this.group.add(dome);
    // gold oculus ring + the shaft of light it implies
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.22, 8, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd977 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, floorY + 16.6, cz);
    this.group.add(ring);
    const sky = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 20),
      new THREE.MeshBasicMaterial({ color: 0xf4ead2 }),
    );
    sky.rotation.x = Math.PI / 2;
    sky.position.set(cx, floorY + 16.55, cz);
    this.group.add(sky);
    const shaft = new THREE.PointLight(0xffe9b8, 1.4, 26, 1.6);
    shaft.position.set(cx, floorY + 10, cz);
    this.group.add(shaft);

    // corner columns (structure) …
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      mk(1.0, 8, 1.0, TRIM, cx + sx * (HALF - 2), floorY + 4, cz + sz * (HALF - 2));
      mk(1.0, 8, 1.0, TRIM, cx + sx * (HALF - 2), floorY + 4, cz);
    }
    // …and the cover ring: six fat pillars with base, shaft, and capital
    for (const pl of PILLARS) {
      mk(2.3, 0.5, 2.3, TRIM, pl.x, floorY + 0.25, pl.z);              // base
      mk(1.9, 7.2, 1.9, 0x525a70, pl.x, floorY + 4.0, pl.z);           // shaft
      mk(2.05, 0.22, 2.05, C.gold, pl.x, floorY + 2.2, pl.z);          // gilt band
      mk(2.3, 0.45, 2.3, TRIM, pl.x, floorY + 7.85, pl.z);             // capital
    }

    for (const lz of [-10, -3.5, 3.5, 10])                            // fluorescent gloom
      for (const lx of [-8, 0, 8])
        mk(3.2, 0.14, 0.7, 0xf2f6e8, cx + lx, floorY + 7.9, cz + lz, true);

    // the seal wall behind him
    const banner = textPlane('ENEMY', '#ffd977', '#28304a', 8.5, 4.2);
    banner.position.set(cx, floorY + 4.6, cz - HALF + 0.02);
    this.group.add(banner);
    const motto = textPlane(MARK_LINE.toUpperCase(), '#9aa4ad', '#2e3140', 12, 0.85);
    motto.position.set(cx, floorY + 2.0, cz - HALF + 0.02);
    this.group.add(motto);

    // the exit: a door you are free to use, in theory
    this.exitPos = new THREE.Vector3(cx, floorY, cz + HALF - 0.4);
    mk(1.5, 2.4, 0.14, 0x23252e, cx, floorY + 1.2, cz + HALF - 0.05);
    const exit = textPlane('EXIT', '#aee3c8', '#1d2a22', 1.1, 0.4);
    exit.position.set(cx, floorY + 2.75, cz + HALF - 0.12);
    exit.rotation.y = Math.PI;
    this.group.add(exit);

    // a desk with unfiled paperwork, purely for menace
    mk(2.6, 0.14, 1.1, 0x8f6a44, cx - 6.5, floorY + 0.95, cz - 13);
    mk(0.24, 0.9, 0.9, 0x6f5236, cx - 7.5, floorY + 0.45, cz - 13);
    mk(0.24, 0.9, 0.9, 0x6f5236, cx - 5.5, floorY + 0.45, cz - 13);
    for (let i = 0; i < 4; i++)
      mk(0.5, 0.1 + (i % 2) * 0.1, 0.4, 0xfdfaf2, cx - 7.1 + i * 0.55, floorY + 1.1, cz - 12.95, true);

    this.boss.root.position.set(cx, floorY, cz - 7);
    this.group.add(this.boss.root);

    // The room never moves: walls, pillars, carpet, desk and strip lights
    // merge to a couple of meshes. The dome (back-side, flat-shaded), the
    // signage (canvas textures) and the oculus light are skipped by rule.
    bakeStatics(this.group, [this.boss.root]);
  }

  nearExit(pos: THREE.Vector3): boolean {
    return pos.distanceTo(this.exitPos) < 2.3;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.boss.update(dt, playerPos);
  }
}
