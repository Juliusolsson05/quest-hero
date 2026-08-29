import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { IslandView } from './world';

/**
 * Tripo GLB set dressing. Every model in assets/models/props is pre-crunched
 * by tools/optimize-props.sh (512px webp textures + meshopt), so a prop costs
 * ~150KB on the wire and a few MB of VRAM — cheap enough to scatter freely.
 *
 * Templates load once and are cloned per placement (geometry and materials
 * are shared by clone()), so ten mushrooms would still upload one mesh.
 */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const templates = new Map<string, Promise<THREE.Group>>();

/** Load + normalize a prop: fit to 1 unit (height or length), ground at y=0,
 *  centered on x/z. Scale the clone to taste afterwards. */
export function propTemplate(file: string, fit: 'height' | 'length' = 'height'): Promise<THREE.Group> {
  let p = templates.get(file);
  if (!p) {
    p = loader.loadAsync(`/assets/models/props/${file}`).then((gltf) => {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const s = 1 / Math.max(fit === 'height' ? size.y : Math.max(size.x, size.z), 0.001);
      root.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(root);
      const center = box2.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box2.min.y, -center.z);
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      const holder = new THREE.Group(); // clean origin so clones scale simply
      holder.add(root);
      return holder;
    });
    templates.set(file, p);
  }
  return p;
}

interface Placement {
  file: string;
  x: number; z: number;
  /** world height (or length for vehicles) in blocks */
  size: number;
  rot?: number;
  fit?: 'height' | 'length';
}

/** Hand-placed around Ashford: kawaii props hugging the paths, vehicles
 *  parked where their story wants them. Coordinates are island tiles. */
const PLACEMENTS: Placement[] = [
  // village set dressing
  { file: 'mushroom-cottage.glb',    x: 11.5, z: 17.5, size: 2.7, rot: 0.9 },
  { file: 'strawberry-mailbox.glb',  x: 12.6, z: 19.4, size: 1.25, rot: 0.5 },
  { file: 'teapot-fountain.glb',     x: 16.5, z: 15.5, size: 1.5, rot: -0.4 },
  { file: 'cloud-bench.glb',         x: 25.5, z: 21.3, size: 1.15, rot: Math.PI },
  { file: 'cat-lamppost.glb',        x: 16.9, z: 30.6, size: 2.3, rot: 2.2 },
  { file: 'boba-water-tower.glb',    x: 38.6, z: 18.5, size: 4.3, rot: -0.7 },
  { file: 'sunflower-planter.glb',   x: 34.4, z: 27.0, size: 1.35, rot: 2.8 },
  { file: 'frog-umbrella-stand.glb', x: 26.6, z: 33.6, size: 1.25, rot: -2.4 },
  { file: 'dango-signpost.glb',      x: 22.7, z: 27.6, size: 1.9, rot: 0.35 },
  { file: 'bread-cart.glb',          x: 31.4, z: 22.2, size: 1.9, rot: 0.25 },
  { file: 'icecream-lamp.glb',       x: 25.8, z: 29.3, size: 2.5, rot: -0.5 },
  { file: 'snail-wheelbarrow.glb',   x: 32.4, z: 12.6, size: 1.15, rot: 1.9 },
  // parked vehicles (the summonable fleet lives in taxi.ts)
  { file: 'waymo-minivan.glb',  x: 15.8, z: 29.2, size: 2.9, rot: Math.PI / 2 + 0.15, fit: 'length' },
  { file: 'bicycle.glb',        x: 24.9, z: 9.8,  size: 1.6, rot: 2.3, fit: 'length' },
  { file: 'vespa-scooter.glb',  x: 32.2, z: 22.6, size: 1.5, rot: -1.1, fit: 'length' },
];

/** Fire-and-forget: props pop in as they load; a missing file just warns. */
export function initProps3d(scene: THREE.Scene, island: IslandView): void {
  for (const p of PLACEMENTS) {
    propTemplate(p.file, p.fit ?? 'height')
      .then((tpl) => {
        const m = tpl.clone();
        m.scale.setScalar(p.size);
        m.position.set(p.x, island.heightAt(p.x, p.z), p.z);
        m.rotation.y = p.rot ?? 0;
        scene.add(m);
      })
      .catch((err) => console.warn(`prop ${p.file} failed to load`, err));
  }
}
