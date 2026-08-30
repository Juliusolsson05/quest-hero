import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnimName, NpcLook } from '../../shared/protocol';
import { bakeStatics } from './bake';
import { shadedBox as shadedVoxel } from './voxel';

/**
 * Character views. Every character works two ways:
 *  - a kawaii voxel box-person placeholder, procedurally animated, so the game
 *    is complete with zero downloaded assets;
 *  - a Tripo GLB (idle/walk/run clips lifted from the sibling animation files)
 *    that transparently replaces the placeholder when the manifest lists it.
 *
 * The SF looks ('techbro-phone', 'techbro-laptop', 'investor') are pure
 * placeholder builds with hand props — glowing phone, open laptop, coffee —
 * and their own idle animations (doomscroll, typing, the periodic sip).
 */

interface Manifest { characters: Record<string, Record<string, string>> }

const loader = new GLTFLoader();
let manifest: Manifest | null = null;

export async function loadManifest(): Promise<void> {
  try {
    const res = await fetch('/assets/models/manifest.json', { cache: 'no-store' });
    if (res.ok) manifest = await res.json();
  } catch { manifest = null; }
}

// Characters shade a touch softer than terrain so faces stay readable.
const SHADES = { top: 1.0, bottom: 0.6, sideX: 0.8, sideZ: 0.92 };
function shadedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  return shadedVoxel(w, h, d, SHADES);
}

// ── SF wardrobe ────────────────────────────────────────────────────────────
/** Per-character wardrobe for the tech looks; unknown ids fall back per look. */
interface TechStyle {
  top: number;              // hoodie or vest
  shirt?: number;           // sleeves/collar under a vest
  pants: number;
  shoes: number;
  hair: number;
  skin: number;
  headgear: 'fringe' | 'capBack' | 'hood' | 'bun' | 'slick' | 'silver';
  capColor?: number;
  sunglasses?: boolean;
  lanyard?: boolean;
}

const TECH_STYLES: Record<string, TechStyle> = {
  // founder: heather-gray hoodie, black jeans, box-fresh sneakers
  blake:  { top: 0xb9c2cc, pants: 0x3f4048, shoes: 0xf5f5f2, hair: 0x8a6742,
            skin: 0xffe8cf, headgear: 'fringe' },
  // growth hacker: mint hoodie, backwards cap
  kayden: { top: 0x9fe0c6, pants: 0x8b8f99, shoes: 0xf5f5f2, hair: 0x3d2f22,
            skin: 0xc98d5f, headgear: 'capBack', capColor: 0x4a4a55 },
  // 10x engineer: charcoal hoodie, hood up, badge lanyard
  tanner: { top: 0x565d6b, pants: 0x3f4048, shoes: 0xf5f5f2, hair: 0x2f2b33,
            skin: 0xffe8cf, headgear: 'hood', lanyard: true },
  // AI researcher: sage vest over lavender long-sleeve, messy bun
  sloane: { top: 0xaec5a0, shirt: 0xcdb8f0, pants: 0x6b6f7a, shoes: 0xf5f5f2,
            hair: 0x4a3628, skin: 0xf2d3b0, headgear: 'bun' },
  // VC: navy quilted vest over light-blue button-down, khakis, wool sneakers
  chad:   { top: 0x39496b, shirt: 0xbcd8f2, pants: 0xcdb891, shoes: 0xb7b3ad,
            hair: 0x6e5335, skin: 0xf7dbb5, headgear: 'slick' },
  // angel: gray fleece vest, silver hair, sunglasses that never come off
  marcus: { top: 0xb0b4bd, shirt: 0xfdfaf2, pants: 0x46474f, shoes: 0x8a6742,
            hair: 0xd8dde2, skin: 0xe0b68f, headgear: 'silver', sunglasses: true },
  // markets guy: deep-green puffer vest over a white quarter-zip, gray slacks.
  // Deliberately a colder, flatter palette than Chad's navy-and-khaki: they
  // share the 'investor' build, so colour is the only thing telling them apart
  // across the square.
  preston: { top: 0x2f5d50, shirt: 0xf4f6f5, pants: 0x767b85, shoes: 0x2e3138,
             hair: 0x4b3a2a, skin: 0xf7dbb5, headgear: 'slick' },
};

const LOOK_DEFAULTS: Record<Exclude<NpcLook, 'villager'>, TechStyle> = {
  'techbro-phone': TECH_STYLES.blake,
  'techbro-laptop': TECH_STYLES.tanner,
  'investor': TECH_STYLES.chad,
};

const darken = (c: number, k = 0.8) => new THREE.Color(c).multiplyScalar(k).getHex();

export class CharacterView {
  readonly root = new THREE.Group();
  private body: THREE.Group | null = null;   // placeholder pieces
  private head?: THREE.Object3D;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimName, THREE.AnimationAction>> = {};
  private current: AnimName = 'idle';
  private t = Math.random() * 10;
  /** anim handles for the SF looks */
  private extras: { phone?: THREE.Group; phoneY?: number;
                    hands?: THREE.Mesh[]; handY?: number;
                    sipArm?: THREE.Group } = {};

  /** Swim rig: legs to kick with, arms that exist only while in the water. */
  private legs: THREE.Object3D[] = [];
  private rig: THREE.Object3D | null = null;   // the GLB, once it lands
  private swimTint = 0xa8e6cf;
  private swimArms: THREE.Group[] = [];
  private swimming = false;

  constructor(readonly id: string, tint: number, readonly height = 1.5,
              readonly look: NpcLook = 'villager') {
    if (look === 'villager') this.buildVillager(tint);
    else this.buildTech(look);
    void this.tryUpgrade();
  }

  // shared little factories for placeholder pieces
  private mkInto(g: THREE.Group) {
    const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.85 });
    const mk = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(shadedBox(w, h, d), mat(c));
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    /** unlit box — reads as glowing (screens, lenses) */
    const lit = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    return { mk, lit };
  }

  private buildVillager(tint: number): void {
    const g = new THREE.Group();
    const { mk } = this.mkInto(g);
    this.legs = [
      mk(0.2, 0.3, 0.24, 0x5a5566, -0.15, 0.15, 0),  // legs
      mk(0.2, 0.3, 0.24, 0x5a5566, 0.15, 0.15, 0),
    ];
    this.swimTint = tint;
    mk(0.62, 0.55, 0.4, tint, 0, 0.58, 0);           // body
    mk(0.5, 0.16, 0.34, tint, 0, 0.3, 0);            // lil skirt/hem
    const head = this.buildHead(g, 0xffe8cf);
    const { mk: mkH } = this.mkInto(head as THREE.Group);
    const hair = mkH(0.7, 0.24, 0.66, darken(tint, 0.55), 0, 0.24, 0);
    hair.castShadow = true;
    this.body = g;
    this.root.add(g);
    // Batch what never moves relative to its group: legs kick and the head
    // nods, so those stay live; everything else becomes one mesh per family.
    bakeStatics(head, []);
    bakeStatics(g, [...this.legs, head]);
  }

  /** Skull + eyes + blush at the standard height; returns the head group. */
  private buildHead(g: THREE.Group, skin: number): THREE.Group {
    const head = new THREE.Group();
    const { mk, lit } = this.mkInto(head);
    mk(0.66, 0.6, 0.62, skin, 0, 0, 0);                          // skull
    lit(0.07, 0.11, 0.03, 0x2c2833, -0.14, 0.02, 0.32);          // eyes
    lit(0.07, 0.11, 0.03, 0x2c2833, 0.14, 0.02, 0.32);
    lit(0.09, 0.05, 0.03, 0xffb3ab, -0.22, -0.12, 0.32);         // blush
    lit(0.09, 0.05, 0.03, 0xffb3ab, 0.22, -0.12, 0.32);
    head.position.y = 1.18;
    g.add(head);
    this.head = head;
    return head;
  }

  /** The SF builds: hoodie/vest bodies, hand props, look-specific headgear. */
  private buildTech(look: Exclude<NpcLook, 'villager'>): void {
    const s = TECH_STYLES[this.id] ?? LOOK_DEFAULTS[look];
    const g = new THREE.Group();
    const { mk } = this.mkInto(g);

    // sneakers + pants
    mk(0.22, 0.12, 0.3, s.shoes, -0.15, 0.06, 0.03);
    mk(0.22, 0.12, 0.3, s.shoes, 0.15, 0.06, 0.03);
    this.legs = [
      mk(0.2, 0.26, 0.24, s.pants, -0.15, 0.27, 0),
      mk(0.2, 0.26, 0.24, s.pants, 0.15, 0.27, 0),
    ];
    this.swimTint = s.top;

    const vest = look === 'investor' || s.shirt !== undefined;
    const sleeve = vest ? s.shirt! : s.top;
    if (vest) {
      mk(0.6, 0.55, 0.38, s.shirt!, 0, 0.58, 0);                 // shirt torso
      mk(0.68, 0.48, 0.46, s.top, 0, 0.56, 0);                   // puffer vest
      for (const y of [0.44, 0.56, 0.68])                        // quilt seams
        mk(0.7, 0.035, 0.48, darken(s.top), 0, y, 0);
      mk(0.05, 0.42, 0.04, 0xd8d4ca, 0, 0.56, 0.24);             // zipper
      mk(0.3, 0.08, 0.1, s.shirt!, 0, 0.87, 0.16);               // collar
    } else {
      mk(0.62, 0.55, 0.4, s.top, 0, 0.58, 0);                    // hoodie torso
      mk(0.36, 0.16, 0.05, darken(s.top), 0, 0.42, 0.21);        // kangaroo pocket
      mk(0.03, 0.14, 0.03, 0xfdfaf2, -0.09, 0.76, 0.215);        // drawstrings
      mk(0.03, 0.14, 0.03, 0xfdfaf2, 0.09, 0.76, 0.215);
      if (s.headgear !== 'hood')                                 // hood, down
        mk(0.46, 0.16, 0.14, darken(s.top), 0, 0.84, -0.24);
    }
    if (s.lanyard) {
      mk(0.08, 0.3, 0.03, 0xe25b3d, 0, 0.74, 0.215);
      mk(0.18, 0.22, 0.03, 0xfdfaf2, 0, 0.54, 0.22);             // badge
    }

    // head + headgear
    const head = this.buildHead(g, s.skin);
    const { mk: mkH } = this.mkInto(head);
    switch (s.headgear) {
      case 'fringe':
        mkH(0.7, 0.22, 0.66, s.hair, 0, 0.25, 0);
        mkH(0.3, 0.1, 0.08, s.hair, 0.12, 0.16, 0.3);            // swoop
        break;
      case 'capBack':
        mkH(0.68, 0.12, 0.64, s.hair, 0, 0.19, 0);
        mkH(0.7, 0.18, 0.66, s.capColor!, 0, 0.31, 0.02);
        mkH(0.46, 0.06, 0.3, s.capColor!, 0, 0.26, -0.45);       // bill, backwards
        break;
      case 'hood':
        mkH(0.74, 0.66, 0.32, s.top, 0, 0.03, -0.22);            // hood shell
        mkH(0.74, 0.2, 0.6, s.top, 0, 0.33, -0.06);
        mkH(0.16, 0.16, 0.16, s.top, 0, 0.08, -0.44);            // hood tip
        break;
      case 'bun':
        mkH(0.7, 0.2, 0.66, s.hair, 0, 0.24, 0);
        mkH(0.24, 0.22, 0.24, s.hair, 0, 0.42, -0.18);           // the bun
        mkH(0.08, 0.24, 0.06, s.hair, -0.3, 0.06, 0.3);          // loose strands
        mkH(0.08, 0.24, 0.06, s.hair, 0.3, 0.06, 0.3);
        break;
      case 'slick':
        mkH(0.68, 0.12, 0.64, s.hair, 0, 0.28, 0);
        break;
      case 'silver':
        mkH(0.68, 0.14, 0.64, s.hair, 0, 0.28, 0);
        mkH(0.6, 0.18, 0.12, s.hair, 0, 0.12, -0.34);            // longer back
        break;
    }
    if (s.sunglasses) {
      const { lit: litH } = this.mkInto(head);
      litH(0.18, 0.15, 0.04, 0x26242e, -0.14, 0.03, 0.335);      // aviators
      litH(0.18, 0.15, 0.04, 0x26242e, 0.14, 0.03, 0.335);
      litH(0.1, 0.05, 0.04, 0x26242e, 0, 0.07, 0.335);
    }
    if (look !== 'investor') {                                   // AirPods
      const { mk: mkH2 } = this.mkInto(head);
      mkH2(0.05, 0.11, 0.05, 0xfafafa, -0.36, -0.02, 0.08);
      mkH2(0.05, 0.11, 0.05, 0xfafafa, 0.36, -0.02, 0.08);
    }

    // arms + the prop that defines the look
    if (look === 'techbro-phone') {
      mk(0.16, 0.4, 0.2, sleeve, -0.39, 0.62, 0);                // left arm down
      mk(0.16, 0.28, 0.2, sleeve, 0.39, 0.74, 0.02);             // right upper arm
      const fa = mk(0.13, 0.13, 0.34, sleeve, 0.33, 0.86, 0.25); // forearm up-forward
      fa.rotation.x = -0.9;
      const phone = new THREE.Group();
      const { mk: mkP, lit: litP } = this.mkInto(phone);
      mkP(0.2, 0.36, 0.05, 0x2b2b33, 0, 0, 0);
      litP(0.17, 0.3, 0.02, 0xd9f2ff, 0, 0, -0.03);              // screen faces him
      mkP(0.06, 0.06, 0.03, s.skin, 0.1, -0.16, -0.03);          // scrolling thumb
      phone.position.set(0.3, 1.02, 0.44);
      phone.rotation.x = -0.55;
      g.add(phone);
      this.extras.phone = phone;
      this.extras.phoneY = phone.position.y;
    } else if (look === 'techbro-laptop') {
      mk(0.16, 0.24, 0.2, sleeve, -0.39, 0.72, 0.04);            // upper arms
      mk(0.16, 0.24, 0.2, sleeve, 0.39, 0.72, 0.04);
      mk(0.13, 0.13, 0.28, sleeve, -0.36, 0.6, 0.2);             // forearms forward
      mk(0.13, 0.13, 0.28, sleeve, 0.36, 0.6, 0.2);
      const h1 = mk(0.11, 0.09, 0.12, s.skin, -0.3, 0.6, 0.36);  // typing hands
      const h2 = mk(0.11, 0.09, 0.12, s.skin, 0.3, 0.6, 0.36);
      const laptop = new THREE.Group();
      const { mk: mkL, lit: litL } = this.mkInto(laptop);
      mkL(0.54, 0.04, 0.36, 0x3a3d45, 0, 0, 0);                  // base
      mkL(0.48, 0.02, 0.3, 0x596070, 0, 0.03, -0.01);            // keyboard
      const screen = mkL(0.54, 0.4, 0.03, 0x3a3d45, 0, 0.2, 0.19);
      screen.rotation.x = 0.42;                                  // hinged back
      const display = litL(0.46, 0.32, 0.01, 0xcfe8ff, 0, 0, 0);
      display.position.set(0, 0.02, -0.022);
      screen.add(display);
      const logo = litL(0.09, 0.09, 0.01, 0xe8e4da, 0, 0, 0);    // fruit logo
      logo.position.set(0, 0.04, 0.022);
      screen.add(logo);
      laptop.position.set(0, 0.6, 0.42);
      g.add(laptop);
      this.extras.hands = [h1, h2];
      this.extras.handY = 0.6;
    } else {
      mk(0.16, 0.4, 0.2, sleeve, -0.39, 0.62, 0);                // left arm down
      mk(0.17, 0.05, 0.21, 0xf2c14e, -0.39, 0.44, 0);            // gold watch
      mk(0.16, 0.26, 0.2, sleeve, 0.39, 0.74, 0.02);             // right upper arm
      const sipArm = new THREE.Group();                          // pivots at elbow
      const { mk: mkA } = this.mkInto(sipArm);
      mkA(0.13, 0.13, 0.3, sleeve, 0, 0, 0.14);                  // forearm
      mkA(0.16, 0.08, 0.16, 0xcdaf8f, 0, 0.02, 0.32);            // cup sleeve
      mkA(0.15, 0.2, 0.15, 0xfdfaf2, 0, 0.08, 0.32);             // the coffee
      mkA(0.16, 0.045, 0.16, 0x8a5a3b, 0, 0.2, 0.32);            // lid
      sipArm.position.set(0.39, 0.64, 0.06);
      g.add(sipArm);
      this.extras.sipArm = sipArm;
    }

    this.body = g;
    this.root.add(g);
    // Batch the outfit: the animated pieces (legs, head, typing hands, the
    // phone, the sip arm) stay live; the rest merges to one mesh per family.
    const live: THREE.Object3D[] = [...this.legs, head];
    if (this.extras.phone) live.push(this.extras.phone);
    if (this.extras.hands) live.push(...this.extras.hands);
    if (this.extras.sipArm) live.push(this.extras.sipArm);
    bakeStatics(head, []);
    if (this.extras.phone) bakeStatics(this.extras.phone, []);
    if (this.extras.sipArm) bakeStatics(this.extras.sipArm, []);
    bakeStatics(g, live);
  }

  /** Swap in the Tripo GLB if the manifest has one for this id. */
  private async tryUpgrade(): Promise<void> {
    const entry = manifest?.characters[this.id];
    if (!entry) return;
    try {
      const base = await loader.loadAsync(`/assets/models/${entry.idle ?? entry.static}`);
      const scene = base.scene;
      // Normalise: unknown source scale → stand `height` tall, feet at y=0.
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const s = this.height / Math.max(size.y, 0.001);
      scene.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box2.min.y;
      const center = box2.getCenter(new THREE.Vector3());
      scene.position.x -= center.x;
      scene.position.z -= center.z;
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) { o.castShadow = true; (o as THREE.Mesh).frustumCulled = false; }
      });

      this.mixer = new THREE.AnimationMixer(scene);
      const takeClip = (gltf: { animations: THREE.AnimationClip[] }, name: AnimName) => {
        const clip = gltf.animations[0];
        if (!clip) return;
        this.actions[name] = this.mixer!.clipAction(clip);
      };
      takeClip(base, 'idle');
      for (const anim of ['walk', 'run'] as const) {
        if (!entry[anim]) continue;
        try { takeClip(await loader.loadAsync(`/assets/models/${entry[anim]}`), anim); } catch { /* keep going */ }
      }
      this.actions[this.current]?.play();

      if (this.body) this.root.remove(this.body);
      this.body = null;
      this.rig = scene;
      this.root.add(scene);
    } catch (err) {
      console.warn(`GLB upgrade failed for ${this.id}, keeping placeholder`, err);
    }
  }

  /**
   * Enter or leave the water. Arms are built on the way in and thrown away on
   * the way out: the placeholder body has none, and every villager NPC shares
   * that build — so a permanent pair would change silhouettes island-wide for
   * the sake of one swimmer.
   */
  setSwimming(on: boolean): void {
    if (on === this.swimming) return;
    this.swimming = on;
    const host = this.body ?? this.rig;

    if (on) {
      if (this.body) {
        for (const side of [-1, 1]) {
          const arm = new THREE.Group();
          const m = new THREE.Mesh(
            shadedBox(0.16, 0.46, 0.16),
            new THREE.MeshStandardMaterial({ color: this.swimTint, vertexColors: true, roughness: 0.85 }),
          );
          m.position.y = -0.23; // hangs from the shoulder, which is the pivot
          m.castShadow = true;
          arm.add(m);
          arm.position.set(side * 0.38, 0.78, 0);
          this.body.add(arm);
          this.swimArms.push(arm);
        }
      }
      return;
    }

    for (const arm of this.swimArms) arm.parent?.remove(arm);
    this.swimArms = [];
    if (host) { host.rotation.set(0, 0, 0); host.position.set(0, 0, 0); }
    for (const leg of this.legs) leg.rotation.x = 0;
    if (this.head) this.head.rotation.set(0, 0, 0);
  }

  setAnim(a: AnimName): void {
    if (a === this.current) return;
    if (this.mixer) {
      const from = this.actions[this.current];
      const to = this.actions[a] ?? this.actions.walk ?? this.actions.idle;
      if (to && to !== from) {
        to.reset().fadeIn(0.18).play();
        from?.fadeOut(0.18);
      }
    }
    this.current = a;
  }

  update(dt: number): void {
    this.t += dt;

    if (this.swimming) {
      const k = this.t * 3.6;                        // one stroke per ~1.7s
      const host = this.body ?? this.rig;
      if (host) {
        host.rotation.x = -1.15;                     // along the surface, face down
        host.rotation.z = Math.sin(k) * 0.22;        // roll into each stroke
        host.position.set(0, 0.1 + Math.sin(k * 2) * 0.03, -0.45);
      }
      for (const [i, leg] of this.legs.entries())    // flutter kick
        leg.rotation.x = Math.sin(k * 2 + i * Math.PI) * 0.45;
      for (const [i, arm] of this.swimArms.entries())
        arm.rotation.x = -(k + i * Math.PI);         // front crawl, arms opposed
      if (this.head) this.head.rotation.x = 0.92 + Math.sin(k) * 0.1; // chin up to breathe
      if (this.mixer) this.mixer.update(dt);
      return;
    }

    if (this.mixer) { this.mixer.update(dt); return; }
    // Procedural kawaii: bob + rock, stronger when moving.
    const b = this.body!;
    const speed = this.current === 'run' ? 11 : this.current === 'walk' ? 7 : 2.2;
    const amp = this.current === 'run' ? 0.07 : this.current === 'walk' ? 0.045 : 0.02;
    b.position.y = Math.abs(Math.sin(this.t * speed)) * amp;
    b.rotation.z = Math.sin(this.t * speed) * (this.current === 'idle' ? 0.01 : 0.06);

    // Look-specific idles layered on top of the bob.
    const ex = this.extras;
    if (this.look === 'techbro-phone' && this.head) {
      // doomscrolling: head down at the slab, phone gently tapping
      this.head.rotation.x = 0.38 + Math.sin(this.t * 1.9) * 0.04;
      if (ex.phone) ex.phone.position.y = ex.phoneY! + Math.sin(this.t * 9) * 0.008;
    } else if (this.look === 'techbro-laptop' && this.head) {
      // typing: eyes on the screen, hands alternating on the keys
      this.head.rotation.x = 0.24 + Math.sin(this.t * 1.6) * 0.03;
      if (ex.hands) {
        const tap = this.current === 'idle' ? 0.022 : 0.01;
        ex.hands[0].position.y = ex.handY! + Math.max(0, Math.sin(this.t * 13)) * tap;
        ex.hands[1].position.y = ex.handY! + Math.max(0, Math.sin(this.t * 13 + Math.PI)) * tap;
      }
    } else if (this.look === 'investor' && ex.sipArm) {
      // every ~7s the coffee comes up for a long, satisfied sip
      const c = this.t % 7;
      const target = c > 5.2 && c < 6.4 ? -1.15 : 0;
      ex.sipArm.rotation.x += (target - ex.sipArm.rotation.x) * Math.min(1, dt * 7);
      if (this.head)
        this.head.rotation.x = Math.sin(this.t * 1.7) * 0.05 + ex.sipArm.rotation.x * -0.12;
    } else if (this.head) {
      this.head.rotation.x = Math.sin(this.t * 1.7) * 0.05;
    }
  }
}

// ── critters (always procedural — they never wait on a rig) ────────────────
export class AnimalView {
  readonly root = new THREE.Group();
  private t = Math.random() * 10;
  private parts: Record<string, THREE.Object3D> = {};
  state = 'wander';

  constructor(readonly kind: 'cat' | 'chicken' | 'butterfly') {
    const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.9 });
    const mk = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, basic = false) => {
      const m = new THREE.Mesh(
        shadedBox(w, h, d),
        basic ? new THREE.MeshBasicMaterial({ color: c }) : mat(c),
      );
      m.position.set(x, y, z);
      m.castShadow = !basic;
      this.root.add(m);
      return m;
    };
    if (kind === 'chicken') {
      this.parts.body = mk(0.34, 0.3, 0.42, 0xfff6ec, 0, 0.28, 0);
      this.parts.head = mk(0.2, 0.2, 0.2, 0xfff6ec, 0, 0.5, 0.2);
      mk(0.07, 0.09, 0.07, 0xe4574f, 0, 0.62, 0.2);           // comb
      mk(0.06, 0.06, 0.1, 0xf2a03d, 0, 0.48, 0.33);           // beak
      mk(0.1, 0.12, 0.1, 0xf2a03d, 0, 0.06, 0);               // feet
    } else if (kind === 'cat') {
      this.parts.body = mk(0.32, 0.28, 0.6, 0x9b93a8, 0, 0.26, 0);
      this.parts.head = mk(0.3, 0.26, 0.26, 0x9b93a8, 0, 0.45, 0.32);
      mk(0.08, 0.12, 0.06, 0x9b93a8, -0.1, 0.62, 0.32);       // ears
      mk(0.08, 0.12, 0.06, 0x9b93a8, 0.1, 0.62, 0.32);
      this.parts.tail = mk(0.07, 0.3, 0.07, 0x847b93, 0, 0.42, -0.32);
      const e = (x: number) => mk(0.04, 0.07, 0.02, 0x2c2833, x, 0.47, 0.46, true);
      e(-0.08); e(0.08);
    } else {
      const w1 = mk(0.32, 0.02, 0.26, 0xffb7d5, -0.17, 0.0, 0);
      const w2 = mk(0.32, 0.02, 0.26, 0xffb7d5, 0.17, 0.0, 0);
      mk(0.07, 0.07, 0.2, 0x4a4a55, 0, 0, 0);
      this.parts.w1 = w1; this.parts.w2 = w2;
      this.root.scale.setScalar(0.8);
    }
    bakeStatics(this.root, Object.values(this.parts));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.kind === 'butterfly') {
      const flap = Math.sin(this.t * 14) * 0.9;
      this.parts.w1.rotation.z = flap;
      this.parts.w2.rotation.z = -flap;
      this.root.position.y += Math.sin(this.t * 2.3) * 0.004;
      return;
    }
    if (this.kind === 'chicken') {
      if (this.state === 'peck') {
        this.parts.head.rotation.x = Math.max(0, Math.sin(this.t * 6)) * 0.9;
      } else {
        this.parts.head.rotation.x = 0;
        this.root.position.y += Math.abs(Math.sin(this.t * 9)) * 0.01; // lil hops
      }
    }
    if (this.kind === 'cat') {
      (this.parts.tail as THREE.Mesh).rotation.x = 0.4 + Math.sin(this.t * 3) * 0.35;
      if (this.state === 'nap') {
        this.root.scale.y = 0.62;
        this.parts.head.position.y = 0.32;
      } else {
        this.root.scale.y = 1;
        this.parts.head.position.y = 0.45;
      }
    }
  }
}
