import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merge the STATIC voxel parts under a group into one mesh per material family.
 *
 * Why: every box a character (or the arena) is built from is its own Mesh with a
 * private material — one draw call each, and again in the shadow pass. Only the
 * boxes that MOVE need to stay separate objects; everything else can be one
 * geometry. Colour is baked into vertex colours so `white material × vertexColor`
 * produces the exact same fragment as `colour material × shade attribute` did.
 *
 * Only meshes that render identically after baking are eligible: plain
 * MeshStandard/MeshBasic materials with no texture map, front-side, no flat
 * shading, opaque. Everything else (canvas-texture signs, the arena dome) is
 * left alone, as is any mesh whose own children can't all come along.
 *
 * Sources are detached but never disposed: baking runs in constructors before
 * first render (nothing is GPU-resident yet), and geometries may be shared.
 */
export function bakeStatics(
  root: THREE.Object3D,
  live: THREE.Object3D[] = [],
  opts: { privateMaterials?: boolean } = {},
): THREE.Mesh[] {
  const liveSet = new Set(live);
  const picked: { mesh: THREE.Mesh; rel: THREE.Matrix4 }[] = [];

  const walk = (obj: THREE.Object3D, parent: THREE.Matrix4): void => {
    for (const child of obj.children) {
      if (liveSet.has(child)) continue; // the caller bakes live groups separately
      child.updateMatrix();
      const rel = new THREE.Matrix4().multiplyMatrices(parent, child.matrix);
      walk(child, rel);
      if ((child as THREE.Mesh).isMesh && mergeable(child as THREE.Mesh)) {
        picked.push({ mesh: child as THREE.Mesh, rel });
      }
    }
  };
  walk(root, new THREE.Matrix4());

  // A mesh whose children were not all picked must stay put — removing it would
  // take its live subtree with it.
  const pickedSet = new Set<THREE.Object3D>(picked.map((p) => p.mesh));
  const eligible = picked.filter(({ mesh }) => mesh.children.every((c) => pickedSet.has(c)));

  // Bucket by everything that must stay uniform across one merged mesh.
  interface Bucket { list: typeof picked; std: boolean; rough: number; cast: boolean; recv: boolean }
  const buckets = new Map<string, Bucket>();
  for (const p of eligible) {
    const m = p.mesh.material as THREE.MeshStandardMaterial;
    const std = m.type === 'MeshStandardMaterial';
    const key = `${std}|${p.mesh.castShadow}|${p.mesh.receiveShadow}|${std ? m.roughness : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { list: [], std, rough: std ? m.roughness : 0, cast: p.mesh.castShadow, recv: p.mesh.receiveShadow };
      buckets.set(key, b);
    }
    b.list.push(p);
  }

  const out: THREE.Mesh[] = [];
  for (const b of buckets.values()) {
    const geos = b.list.map(({ mesh, rel }) => {
      const g = mesh.geometry.clone();
      bakeColor(g, mesh.material as THREE.MeshStandardMaterial);
      g.applyMatrix4(rel);
      return g;
    });
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose(); // the clones are ours; sources stay untouched
    const mesh = new THREE.Mesh(merged, material(b.std, b.rough, opts.privateMaterials === true));
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    root.add(mesh);
    out.push(mesh);
  }
  for (const { mesh } of eligible) mesh.removeFromParent();
  return out;
}

function mergeable(mesh: THREE.Mesh): boolean {
  if (Array.isArray(mesh.material)) return false;
  const m = mesh.material as THREE.MeshStandardMaterial;
  if (m.type !== 'MeshStandardMaterial' && m.type !== 'MeshBasicMaterial') return false;
  if (m.map || m.transparent || m.side !== THREE.FrontSide || m.flatShading) return false;
  return true;
}

/**
 * Fold the material colour into the geometry's colour attribute. A material
 * that had vertexColors on multiplied the attribute (the voxel shading), so we
 * multiply; one that had it off ignored the attribute, so we overwrite.
 */
function bakeColor(g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial): void {
  const count = g.getAttribute('position').count;
  let colors = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colors || !m.vertexColors) {
    colors = new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3);
    g.setAttribute('color', colors);
  }
  for (let i = 0; i < count; i++) {
    colors.setXYZ(i, colors.getX(i) * m.color.r, colors.getY(i) * m.color.g, colors.getZ(i) * m.color.b);
  }
}

// One white material per family serves every baked mesh in the game; the boss
// asks for private ones because his hit-flash animates `emissive`.
const shared = new Map<string, THREE.Material>();
function material(std: boolean, rough: number, priv: boolean): THREE.Material {
  const make = (): THREE.Material => std
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough })
    : new THREE.MeshBasicMaterial({ vertexColors: true });
  if (priv) return make();
  const key = `${std}|${rough}`;
  let m = shared.get(key);
  if (!m) { m = make(); shared.set(key, m); }
  return m;
}
