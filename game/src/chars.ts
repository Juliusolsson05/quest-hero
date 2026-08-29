import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnimName } from '../../shared/protocol';

/**
 * Character views. Every character works two ways:
 *  - a kawaii voxel box-person placeholder, procedurally animated, so the game
 *    is complete with zero downloaded assets;
 *  - a Tripo GLB (idle/walk/run clips lifted from the sibling animation files)
 *    that transparently replaces the placeholder when the manifest lists it.
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

function shadedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const n = g.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i), nx = n.getX(i);
    const v = ny > 0.5 ? 1.0 : ny < -0.5 ? 0.6 : Math.abs(nx) > 0.5 ? 0.8 : 0.92;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export class CharacterView {
  readonly root = new THREE.Group();
  private body: THREE.Group | null = null;   // placeholder pieces
  private head?: THREE.Object3D;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimName, THREE.AnimationAction>> = {};
  private current: AnimName = 'idle';
  private t = Math.random() * 10;

  constructor(readonly id: string, tint: number, readonly height = 1.5) {
    this.buildPlaceholder(tint);
    void this.tryUpgrade();
  }

  private buildPlaceholder(tint: number): void {
    const g = new THREE.Group();
    const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.85 });
    const mk = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(shadedBox(w, h, d), mat(c));
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    mk(0.2, 0.3, 0.24, 0x5a5566, -0.15, 0.15, 0);   // legs
    mk(0.2, 0.3, 0.24, 0x5a5566, 0.15, 0.15, 0);
    mk(0.62, 0.55, 0.4, tint, 0, 0.58, 0);           // body
    mk(0.5, 0.16, 0.34, tint, 0, 0.3, 0);            // lil skirt/hem
    const head = new THREE.Group();
    const skull = new THREE.Mesh(shadedBox(0.66, 0.6, 0.62), mat(0xffe8cf));
    skull.castShadow = true;
    head.add(skull);
    const hair = new THREE.Mesh(shadedBox(0.7, 0.24, 0.66), mat(new THREE.Color(tint).multiplyScalar(0.55).getHex()));
    hair.position.y = 0.24;
    head.add(hair);
    const eye = (x: number) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.03), new THREE.MeshBasicMaterial({ color: 0x2c2833 }));
      e.position.set(x, 0.02, 0.32);
      head.add(e);
    };
    eye(-0.14); eye(0.14);
    const blush = (x: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0xffb3ab }));
      b.position.set(x, -0.12, 0.32);
      head.add(b);
    };
    blush(-0.22); blush(0.22);
    head.position.y = 1.18;
    g.add(head);
    this.head = head;
    this.body = g;
    this.root.add(g);
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
      this.root.add(scene);
    } catch (err) {
      console.warn(`GLB upgrade failed for ${this.id}, keeping placeholder`, err);
    }
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
    if (this.mixer) { this.mixer.update(dt); return; }
    // Procedural kawaii: bob + rock, stronger when moving.
    const b = this.body!;
    const speed = this.current === 'run' ? 11 : this.current === 'walk' ? 7 : 2.2;
    const amp = this.current === 'run' ? 0.07 : this.current === 'walk' ? 0.045 : 0.02;
    b.position.y = Math.abs(Math.sin(this.t * speed)) * amp;
    b.rotation.z = Math.sin(this.t * speed) * (this.current === 'idle' ? 0.01 : 0.06);
    if (this.head) this.head.rotation.x = Math.sin(this.t * 1.7) * 0.05;
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
