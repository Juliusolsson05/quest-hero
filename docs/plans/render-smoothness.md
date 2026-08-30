# Render Smoothness Implementation Plan

> **For agentic workers:** execute task-by-task; each task ends with a passing
> `npm --prefix game run build` and a commit. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the game render dramatically smoother with **zero visible change** — same
pixels, same gameplay — by cutting draw calls (static-part merging, instancing) and
eliminating steady per-frame allocation (GC hitches).

**Architecture:** The world already batches aggressively (`world.ts` instances terrain and
merges props per colour); characters, the painted horizon, lamp heads, and the IRS arena
never got the same treatment — each little box is its own `Mesh` with a private material,
and each of those is a draw call in the camera pass *and again* in the shadow pass. A new
`bake.ts` helper merges the static boxes under any group into one mesh per material family,
baking part colours into vertex colours so the shader math (`materialColor × vertexColor`)
is unchanged. Animated parts (legs, heads, hand props, arms, bazooka) stay live meshes.
Separately, every `new THREE.Vector3/Color` in the frame loop becomes a reused scratch
object, and the one per-frame `innerHTML` write is deduplicated.

**Tech Stack:** three.js 0.181 (`mergeGeometries` from
`three/addons/utils/BufferGeometryUtils.js`, already used by `world.ts`), TypeScript 5.9,
Vite 7.

**Spec:** GitHub issue #18 (motivation, intended behavior, acceptance criteria).

## Global Constraints

- **Pixel-identical output.** Never change: shadow map size, pixel ratio, bloom params,
  fog, tone mapping, geometry shapes, colours, shading constants, animation math.
- Baking rule: if the source material had `vertexColors: true`, multiply the geometry's
  colour attribute by the material colour; if it had `vertexColors: false`, **overwrite**
  the attribute with the material colour (the old shader ignored the attribute).
- Never merge: materials with a `map` (canvas-texture signage), `side !== FrontSide`
  (the arena dome), `flatShading`, or `transparent`.
- Never dispose source geometries/materials in `bake.ts` — baking runs in constructors
  before first render (nothing is GPU-resident), and geometries may come from a shared
  cache.
- Repo law (docs/plans/feature-isolation.md): `game/` and `hub/` import `shared/` only;
  features stay whole in their directories; `main.ts` stays wiring-only.
- No test suite exists by design (hackathon demo-ware). Every task's gate is
  `npm --prefix game run build` (tsc + vite) plus the browser smoke in Task 7.

---

### Task 1: `bake.ts` — merge static voxel parts under a group

**Files:**
- Create: `game/src/bake.ts`

**Interfaces:**
- Produces: `bakeStatics(root: THREE.Object3D, live?: THREE.Object3D[], opts?: { privateMaterials?: boolean }): THREE.Mesh[]`
  — merges every eligible static `Mesh` under `root` (skipping `live` subtrees) into one
  mesh per `(materialType, castShadow, receiveShadow, roughness)` bucket, adds the merged
  meshes to `root`, detaches the originals, and returns the merged meshes (callers that
  need to tint — the boss — pass `privateMaterials: true` and register the returned
  meshes' `MeshStandardMaterial`s).

- [ ] **Step 1: Write the module**

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merge the STATIC voxel parts under a group into one mesh per material family.
 *
 * Why: every box a character (or the arena) is built from is its own Mesh with a
 * private material — one draw call each, twice with the shadow pass. The visuals
 * only need the boxes that MOVE to be separate objects; everything else can be one
 * geometry. Colour is baked into vertex colours so `white material × vertexColor`
 * produces the exact same fragment as `colour material × shade attribute` did.
 *
 * Only meshes that render identically after baking are eligible: plain
 * MeshStandard/MeshBasic materials, no texture map, front-side, no flat shading,
 * opaque. Everything else (canvas-texture signs, the arena dome) is left alone.
 *
 * Sources are detached but never disposed: baking happens in constructors before
 * first render (nothing is GPU-resident yet) and geometries may be cache-shared.
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
      if (liveSet.has(child)) continue; // caller bakes live groups separately
      child.updateMatrix();
      const rel = new THREE.Matrix4().multiplyMatrices(parent, child.matrix);
      walk(child, rel); // children first — a static mesh may parent static meshes
      if ((child as THREE.Mesh).isMesh && mergeable(child as THREE.Mesh)) {
        picked.push({ mesh: child as THREE.Mesh, rel });
      }
    }
  };
  walk(root, new THREE.Matrix4());

  // A mesh whose children were NOT all picked must stay live (its subtree hangs
  // off it) — drop it and its ancestors' claim to it.
  const pickedSet = new Set(picked.map((p) => p.mesh));
  const eligible = picked.filter(({ mesh }) =>
    mesh.children.every((c) => pickedSet.has(c as THREE.Mesh)));

  // Bucket by everything that must stay uniform on one merged mesh.
  const buckets = new Map<string, { list: typeof picked; std: boolean; rough: number;
                                    cast: boolean; recv: boolean }>();
  for (const p of eligible) {
    const m = p.mesh.material as THREE.MeshStandardMaterial;
    const std = (m as THREE.Material).type === 'MeshStandardMaterial';
    const key = `${std}|${p.mesh.castShadow}|${p.mesh.receiveShadow}|${std ? m.roughness : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { list: [], std, rough: std ? m.roughness : 0,
            cast: p.mesh.castShadow, recv: p.mesh.receiveShadow };
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
    for (const g of geos) g.dispose(); // the clones are ours; sources stay
    const mat = material(b.std, b.rough, opts.privateMaterials === true);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    root.add(mesh);
    out.push(mesh);
  }
  for (const { mesh } of eligible) mesh.removeFromParent();
  return out;
}

function mergeable(mesh: THREE.Mesh): boolean {
  const m = mesh.material as THREE.MeshStandardMaterial;
  if (Array.isArray(mesh.material)) return false;
  if (m.type !== 'MeshStandardMaterial' && m.type !== 'MeshBasicMaterial') return false;
  if (m.map || m.transparent || m.side !== THREE.FrontSide || m.flatShading) return false;
  return true;
}

/** Fold the material colour into the geometry's colour attribute (see baking rule). */
function bakeColor(g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial): void {
  const count = g.getAttribute('position').count;
  let colors = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const useExisting = !!colors && m.vertexColors; // old shader multiplied these
  if (!colors || !useExisting) {
    colors = new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3);
    g.setAttribute('color', colors);
  }
  for (let i = 0; i < count; i++) {
    colors.setXYZ(i, colors.getX(i) * m.color.r, colors.getY(i) * m.color.g,
                  colors.getZ(i) * m.color.b);
  }
}

// One white material per family serves every baked mesh in the game; the boss
// asks for private ones because it animates `emissive` on hit-flash.
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
```

- [ ] **Step 2: Build** — `npm --prefix game run build` → passes (new module, no consumers yet, but `noUnusedLocals` only applies to locals, exported symbols fine).
- [ ] **Step 3: Commit** — `perf(game): add bake.ts — merge static voxel parts into one mesh per material family`

### Task 2: bake characters and animals (`chars.ts`)

**Files:**
- Modify: `game/src/chars.ts`

**Interfaces:**
- Consumes: `bakeStatics(root, live)` from Task 1.
- Produces: no API change — `CharacterView`/`AnimalView` publics unchanged.

- [ ] **Step 1:** Import `bakeStatics`. At the **end of `buildVillager`** add:

```ts
    bakeStatics(head, []);                 // skull+hair → 1 std, eyes+blush → 1 basic
    bakeStatics(g, [...this.legs, head]);  // body+hem → 1 mesh; legs and head stay live
```

- [ ] **Step 2:** At the **end of `buildTech`**, after `this.body = g`, add (build the live
  list from exactly the parts the animations touch — legs always; hands, phone, sipArm
  when present):

```ts
    const live: THREE.Object3D[] = [...this.legs, head];
    if (this.extras.phone) live.push(this.extras.phone);
    if (this.extras.hands) live.push(...this.extras.hands);
    if (this.extras.sipArm) live.push(this.extras.sipArm);
    bakeStatics(head, []);
    if (this.extras.phone) bakeStatics(this.extras.phone, []);
    if (this.extras.sipArm) bakeStatics(this.extras.sipArm, []);
    bakeStatics(g, live);
```

  (The laptop group is fully static — body bake absorbs it, screen hinge included, because
  the guard only skips meshes with unpicked children.)

- [ ] **Step 3:** In `AnimalView`'s constructor, after the species `if/else` chain:

```ts
    bakeStatics(this.root, Object.values(this.parts));
```

- [ ] **Step 4:** Build; then quick sanity in the running game later (Task 7): villagers,
  tech NPCs (doomscroll/typing/sip idles), swim (arms appear/kick), animals.
- [ ] **Step 5: Commit** — `perf(game): characters render as ~5 meshes instead of ~25`

### Task 3: bake the IRS arena, Mark, and the SMG

**Files:**
- Modify: `game/src/irs/arena.ts`, `game/src/irs/boss-fight.ts`

- [ ] **Step 1 (`arena.ts`, `Taxcollector`):** import `bakeStatics`. At the end of the
  constructor, replace the per-part `tintable` registrations with baked buckets — delete
  nothing else. Concretely: keep `mat()` as-is during construction, then:

```ts
    // Merge the suit: everything except the groups the fight animates. The baked
    // materials replace the per-part ones in `tintable` — the hit-flash tints the
    // whole silhouette exactly as before, through 6 materials instead of ~30.
    this.tintable.length = 0;
    const groups = [this.torso, this.head, this.armL, this.armR, this.bazooka];
    for (const baked of [
      ...bakeStatics(this.root, groups, { privateMaterials: true }),
      ...groups.flatMap((g) => bakeStatics(g, [], { privateMaterials: true })),
    ]) {
      const m = baked.material as THREE.MeshStandardMaterial;
      if (m.type === 'MeshStandardMaterial') this.tintable.push(m);
    }
```

  (The `ENEMY` chest plane and `DENIED` stencil have canvas maps — `bakeStatics` leaves
  them untouched automatically.)

- [ ] **Step 2 (`arena.ts`, `IrsArena`):** at the end of the constructor:

```ts
    bakeStatics(this.group, [this.boss.root]); // walls/pillars/desk/strips → ~2 meshes
```

  (Dome is BackSide+flatShading, signage has maps, the shaft is a light — all skipped.)

- [ ] **Step 3 (`boss-fight.ts`):** after the gun parts are built (`this.gun` fully
  assembled, before `player.view.root.add(this.gun)`): `bakeStatics(this.gun, []);`
  — import from `../bake`.
- [ ] **Step 4:** Build.
- [ ] **Step 5: Commit** — `perf(irs): arena room, Mark, and the SMG render batched`

### Task 4: merge the painted horizon (`distance.ts`)

**Files:**
- Modify: `game/src/distance.ts`

- [ ] **Step 1:** Instead of one `Mesh` per block, collect a `BoxGeometry` per block with
  the transform baked in, and emit **one mesh per layer** (the per-frame haze tint
  already lives on the shared layer material, so colour behavior is untouched):

```ts
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
```

  - Give each `DistanceLayer` a private `geos: THREE.BoxGeometry[]` (a local
    `Map<DistanceLayer, THREE.BoxGeometry[]>` beside `layers` — the exported interface
    does not change).
  - `block()` becomes: create the `BoxGeometry`, `g.rotateY(-a)`,
    `g.translate(cx + cos(a)*r, SEA_Y + lift + h/2, cz + sin(a)*r)`, push to the layer's
    list (no `Mesh`, no `group.add`). Its return value is unused — drop it.
  - After the three band sections: for each layer,
    `group.add(new THREE.Mesh(mergeGeometries(list), layer.material))`.
- [ ] **Step 2:** Build. Visual check in Task 7: horizon identical at day/dusk/fog.
- [ ] **Step 3: Commit** — `perf(game): the painted horizon is 3 draw calls, not ~150`

### Task 5: `fx.ts` — instanced lamp heads and an allocation-free sky rig

**Files:**
- Modify: `game/src/fx.ts`

- [ ] **Step 1 (lamp heads):** in `attachWorld`, replace the per-lamp head `Mesh` with one
  `InstancedMesh` sharing one `MeshBasicMaterial`; keep the ≤5 real `PointLight`s exactly
  as they are:

```ts
    let lampHeads: THREE.InstancedMesh | null = null;   // field: was lampHeads: Mesh[]
    if (built.lamps.length) {
      lampHeads = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.3, 0.26, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x6a614f }),
        built.lamps.length,
      );
      const m = new THREE.Matrix4();
      built.lamps.forEach((p, i) => lampHeads!.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
      this.scene.add(lampHeads);
    }
```

  and in `update()` the head-colour loop becomes one material write (every head always
  received the same colour before — behavior identical):

```ts
    if (this.lampHeads) {
      (this.lampHeads.material as THREE.MeshBasicMaterial).color
        .set(darkness > 0.4 ? 0xffd98a : 0x6a614f);
    }
```

- [ ] **Step 2 (scratch objects):** remove every per-frame `new THREE.Color`/`new
  THREE.Vector3` from `stopAt()`/`update()`:
  - Module consts: `const GREY = new THREE.Color(0x9aa4ad); const WHITE = new THREE.Color(0xffffff);`
  - Fields: `private readonly stop = { sky: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), sunInt: 0, hemiInt: 0, fogFar: 0 };`
    plus scratch `cB`, `skyMix`, `horMix` Colors and `sunDir` Vector3.
  - `stopAt(h)` becomes `void`, writing into `this.stop`:
    `this.stop.sky.setHex(a.sky).lerp(this.cB.setHex(b.sky), t)` (same lerp math), numeric
    fields as before.
  - `update()`: `this.skyMix.copy(this.stop.sky).lerp(GREY, mod.grey * this.weatherBlend)`
    (same for horizon with `mod.grey * 0.9`), `this.sun.color.copy(this.stop.sun)`,
    `this.hemi.color.copy(this.skyMix).lerp(WHITE, 0.35)`,
    `this.sunDir.set(...)` for both night/day branches. **Do not** reorder any math.
- [ ] **Step 3:** Build.
- [ ] **Step 4: Commit** — `perf(game): sky rig allocates nothing per frame; lamp heads instanced`

### Task 6: zero-alloc frame loop + DOM dedupe (`player.ts`, `main.ts`, `entities.ts`, `ui.ts`)

**Files:**
- Modify: `game/src/player.ts`, `game/src/main.ts`, `game/src/entities.ts`, `game/src/ui.ts`

- [ ] **Step 1 (`player.ts`):** module const `const UP = new THREE.Vector3(0, 1, 0);`
  fields `private readonly moveDir/camTarget/camOff/camWanted = new THREE.Vector3()` (4
  fields). In `update()`: `const dir = this.moveDir.set(str, 0, -fwd).normalize().applyAxisAngle(UP, this.camYaw);`
  In `finish()`: `const target = this.camTarget.set(this.pos.x, this.pos.y + 1.35, this.pos.z);`
  `const off = this.camOff.set(...).multiplyScalar(this.camDist);`
  `const wanted = this.camWanted.copy(target).add(off);` — everything downstream reads the
  same locals, so no other line changes.
- [ ] **Step 2 (`entities.ts`):** `private readonly anchorV = new THREE.Vector3();` and
  `anchor()` returns `this.anchorV.copy(n.view.root.position)` with `this.anchorV.y += 2.1`
  — add a doc line: returned vector is reused; callers copy it immediately (Bubbles does).
- [ ] **Step 3 (`main.ts`):** the bubble anchor callback becomes
  `playerAnchor.set(player.pos.x, player.pos.y + 2.05, player.pos.z)`; add
  `powerPreference: 'high-performance'` to the `WebGLRenderer` options; add `renderer` to
  the dev-only `__sfq` handle (for draw-call measurement).
- [ ] **Step 4 (`ui.ts`):** `setPrompt` caches the last value:

```ts
  private lastPrompt: string | null = null;
  setPrompt(html: string | null): void {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    if (html) { this.prompt.innerHTML = html; this.prompt.classList.add('on'); }
    else this.prompt.classList.remove('on');
  }
```

- [ ] **Step 5:** Build.
- [ ] **Step 6: Commit** — `perf(game): zero per-frame allocation in the frame loop; prompt DOM writes deduped`

### Task 7: measure, smoke, PR

- [ ] **Step 1 (before-numbers):** `git stash` nothing — instead check out the plan commit's
  parent state for measurement is unnecessary: measure **before** on `main`'s code by
  running the dev server from the plan commit (which contains no code changes yet is
  wrong once tasks land — so do this FIRST, right after Task 1's commit… in practice:
  measure before-numbers immediately after committing the plan, using a throwaway local
  patch that only adds `renderer` to `__sfq`, then `git checkout -- game/src/main.ts`).
  Record `renderer.info.render.calls`, `.triangles`, and a 5-second frame-time sample at
  the plaza spawn, and inside the IRS arena.
- [ ] **Step 2:** Start an isolated hub (`PORT=7799 npm --prefix hub run start` — boots
  with empty env, canned dialogue) and the game dev server on a spare port
  (`npm --prefix game run dev -- --port 5199 --strictPort`), open
  `http://localhost:5199/?room=PERFSMOKE&hub=ws://localhost:7799/ws`.
- [ ] **Step 3 (smoke):** verify — city + NPCs render and idle-animate; talk prompt
  appears/disappears; swim (splash, arms, kick); summon + ride a cart; enter the IRS
  door, full fight (laser, rocket, tracers, hit-flash, cover), win or lose, exit;
  weather/time chips update. Screenshot the plaza and the fight.
- [ ] **Step 4 (after-numbers):** same two positions, record the same metrics. Update
  issue #18 with the numbers.
- [ ] **Step 5:** `npm --prefix game run build` one final time; review `git diff main` for
  unrelated changes; push branch; open PR titled
  `perf(game): 3-6x fewer draw calls and an allocation-free frame loop, visuals unchanged`
  with `Fixes #18`, the before/after table, and the no-tests rationale (no test infra by
  design; behavior-preserving change verified by typecheck + smoke + renderer metrics).
  **Do not merge.**
