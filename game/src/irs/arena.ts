import * as THREE from 'three';
import { C } from '../world';
import { angleToward } from '../util';
import { shadedBox as shadedVoxel } from '../voxel';

/**
 * The IRS audit chamber: a separate room far off the island grid — past the
 * fog, so neither world can see the other — and the taxcollector who lives in
 * it. No mechanics yet: he paces, he looms, he taps the clipboard. The set
 * and the presence; the fight comes later.
 */

const HALF = 16;
export const IRS_ARENA = {
  cx: 160,
  cz: -60,
  floorY: 1,
  /** Where the player materialises: just inside the south door. */
  entrance: { x: 160, z: -60 + HALF - 2.6 },
  bounds: { minX: 160 - HALF + 0.7, maxX: 160 + HALF - 0.7, minZ: -60 - HALF + 0.7, maxZ: -60 + HALF - 0.7, y: 1 },
};

// The chamber shades flatter than the city — fluorescent gloom, no sun.
const SHADES = { top: 1, bottom: 0.62, sideX: 0.82, sideZ: 0.82 };
function shadedBox(w = 1, h = 1, d = 1): THREE.BoxGeometry {
  return shadedVoxel(w, h, d, SHADES);
}

function textPlane(text: string, fg: string, bg: string, w: number, h: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = Math.round(512 * (h / w));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  ctx.font = `900 ${Math.round(canvas.height * 0.62)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + canvas.height * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
}

// ── the taxcollector ────────────────────────────────────────────────────────

type BossState = 'pace' | 'consider' | 'neckcrack';

class Taxcollector {
  readonly root = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly torso: THREE.Group;

  private state: BossState = 'consider';
  private stateT = 1.5;
  private waypoint = 0;
  private rot = Math.PI; // facing the door when you walk in
  private t = 0;

  /** North half of the hall — he never crowds the exit. */
  private readonly route = [
    { x: IRS_ARENA.cx - 10, z: IRS_ARENA.cz - 9 },
    { x: IRS_ARENA.cx + 10, z: IRS_ARENA.cz - 9 },
    { x: IRS_ARENA.cx + 10, z: IRS_ARENA.cz - 2 },
    { x: IRS_ARENA.cx - 10, z: IRS_ARENA.cz - 2 },
    { x: IRS_ARENA.cx, z: IRS_ARENA.cz - 11.5 },
  ];

  constructor() {
    const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.85 });
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
    const chest = textPlane('IRS', '#28304a', '#f6f3ea', 0.62, 0.3);
    chest.position.set(0.42, 0.72, 0.44);
    this.torso.add(chest);

    // arms: shoulder-pivot groups so they can swing and tap
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

    this.root.scale.setScalar(0.92); // ~2.6 tall on a 1.5-tall street
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.t += dt;
    this.stateT -= dt;
    const p = this.root.position;

    const faceToward = (tx: number, tz: number, rate: number) => {
      this.rot = angleToward(this.rot, Math.atan2(tx - p.x, tz - p.z), dt * rate);
    };

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
        // the heavy gait: slow thudding bob, shoulders rolling
        p.y = IRS_ARENA.floorY + Math.abs(Math.sin(this.t * 4.4)) * 0.055;
        this.torso.rotation.z = Math.sin(this.t * 4.4) * 0.05;
        this.armL.rotation.x = Math.sin(this.t * 4.4) * 0.28;
        this.armR.rotation.x = -Math.sin(this.t * 4.4) * 0.28;
      }
    } else if (this.state === 'consider') {
      // stops, finds you, taps the clipboard
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

    // idle breathing on the whole frame, always
    this.torso.scale.y = 1 + Math.sin(this.t * 1.8) * 0.012;
    this.head.rotation.x = Math.sin(this.t * 1.6) * 0.03;

    this.root.rotation.y = this.rot;
  }
}

// ── the chamber ─────────────────────────────────────────────────────────────

export class IrsArena {
  readonly group = new THREE.Group();
  private readonly boss = new Taxcollector();
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
    mk(W + 1.2, 0.5, W + 1.2, TRIM, cx, floorY + 8.25, cz);           // ceiling

    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {             // columns
      mk(1.0, 8, 1.0, TRIM, cx + sx * (HALF - 2), floorY + 4, cz + sz * (HALF - 2));
      mk(1.0, 8, 1.0, TRIM, cx + sx * (HALF - 2), floorY + 4, cz);
    }

    for (const lz of [-10, -3.5, 3.5, 10])                            // fluorescent gloom
      for (const lx of [-8, 0, 8])
        mk(3.2, 0.14, 0.7, 0xf2f6e8, cx + lx, floorY + 7.9, cz + lz, true);

    // the seal wall behind him
    const banner = textPlane('IRS', '#ffd977', '#28304a', 8.5, 4.2);
    banner.position.set(cx, floorY + 4.6, cz - HALF + 0.02);
    this.group.add(banner);
    const motto = textPlane('EVERY COIN COUNTED', '#9aa4ad', '#2e3140', 10, 0.85);
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
  }

  nearExit(pos: THREE.Vector3): boolean {
    return pos.distanceTo(this.exitPos) < 2.3;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.boss.update(dt, playerPos);
  }
}
