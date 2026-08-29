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
      // Vehicles ('length' fit) must all agree on an axis: some Tripo models are
      // authored along x (both waymos, the vespa) — turn them so length runs
      // along z, matching the taxi, so a heading of rotation.y drives nose-first.
      if (fit === 'length' && size.x > size.z) root.rotateY(Math.PI / 2);
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

/** Hand-placed around Ashford-by-the-Bay: kawaii props hugging the parks and
 *  plazas, vehicles parked at the curb. Coordinates are island tiles. */
const PLACEMENTS: Placement[] = [
  // city set dressing
  { file: 'mushroom-cottage.glb',    x: 18.5, z: 51.0, size: 2.7, rot: 0.9 },   // Golden Gate Park
  { file: 'teapot-fountain.glb',     x: 27.0, z: 53.6, size: 1.5, rot: -0.4 },  // Golden Gate Park
  { file: 'strawberry-mailbox.glb',  x: 26.6, z: 75.6, size: 1.25, rot: 0.5 },  // farm gate
  { file: 'cloud-bench.glb',         x: 50.6, z: 42.5, size: 1.15, rot: Math.PI }, // plaza
  { file: 'dango-signpost.glb',      x: 50.4, z: 41.2, size: 1.9, rot: 0.35 },  // plaza north
  { file: 'cat-lamppost.glb',        x: 34.4, z: 51.6, size: 2.3, rot: 2.2 },   // Alamo Square
  { file: 'boba-water-tower.glb',    x: 25.5, z: 77.4, size: 4.3, rot: -0.7 },  // farm
  { file: 'sunflower-planter.glb',   x: 44.3, z: 44.6, size: 1.35, rot: 2.8 },  // market
  { file: 'frog-umbrella-stand.glb', x: 84.2, z: 42.8, size: 1.25, rot: -2.4 }, // Ferry Building
  { file: 'bread-cart.glb',          x: 43.8, z: 42.9, size: 1.9, rot: 0.25 },  // market
  { file: 'icecream-lamp.glb',       x: 51.6, z: 25.4, size: 2.5, rot: -0.5 },  // Gate overlook
  { file: 'snail-wheelbarrow.glb',   x: 22.4, z: 78.2, size: 1.15, rot: 1.9 },  // farm
  // parked vehicles (the summonable fleet lives in cartly/carts.ts)
  { file: 'waymo-minivan.glb',  x: 45.6, z: 50.5, size: 2.9, rot: 0.08, fit: 'length' },  // curb on the avenue
  { file: 'bicycle.glb',        x: 61.3, z: 30.4, size: 1.6, rot: 2.3, fit: 'length' },   // Telegraph Hill path
  { file: 'vespa-scooter.glb',  x: 44.6, z: 45.5, size: 1.5, rot: -1.1, fit: 'length' },  // market curb
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
