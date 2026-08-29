import * as THREE from 'three';
import { SEA_Y } from './world';

/**
 * The painted distance: three bands of simple geometry ringing the island —
 * rocks, then headlands, then a skyline — each further out, flatter and hazier
 * than the last. Overlapping silhouettes at different depths are the cheapest
 * depth cue there is, and because these sit at real positions they parallax
 * properly as you walk or swim toward them.
 *
 * They opt out of scene fog. Instead `Atmosphere` tints each band toward the
 * sky's current horizon colour every frame, so the skyline turns pink at
 * sunset, blue at night, and nearly disappears in fog weather — for free, off
 * the rig the sky already runs on.
 */
export interface DistanceLayer {
  material: THREE.MeshBasicMaterial;
  /** Colour at zero haze — what the band would be if it were close. */
  base: THREE.Color;
  /** How far toward the horizon colour this band sits. Further = hazier. */
  haze: number;
}

export interface Distance {
  group: THREE.Group;
  layers: DistanceLayer[];
}

/** Deterministic noise, so the horizon is the same skyline on every load. */
function rnd(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function buildDistance(center: THREE.Vector3): Distance {
  const group = new THREE.Group();
  const layers: DistanceLayer[] = [];

  const layer = (baseHex: number, haze: number): DistanceLayer => {
    const base = new THREE.Color(baseHex);
    const l: DistanceLayer = {
      material: new THREE.MeshBasicMaterial({ color: base.clone(), fog: false }),
      base,
      haze,
    };
    layers.push(l);
    return l;
  };

  /** A block standing on the sea, `w`×`h`×`d`, `r` out at bearing `a`. */
  const block = (
    l: DistanceLayer, a: number, r: number,
    w: number, h: number, d: number, lift = 0,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), l.material);
    m.position.set(
      center.x + Math.cos(a) * r,
      SEA_Y + lift + h / 2,
      center.z + Math.sin(a) * r,
    );
    m.rotation.y = -a; // broad face toward the island
    group.add(m);
    return m;
  };

  // ── near band: rocks and stacks out past the swimmable water ──────────────
  const rocks = layer(0x6e8b78, 0.34);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd(i) * 0.4;
    const r = 108 + rnd(i + 40) * 46;
    const w = 7 + rnd(i + 80) * 11;
    const h = 3.5 + rnd(i + 120) * 7;
    block(rocks, a, r, w, h, w * 0.8);
    // A smaller shoulder, so the silhouette is not a row of identical lumps.
    if (rnd(i + 160) > 0.4) {
      block(rocks, a + 0.035, r * 0.985, w * 0.55, h * 0.6, w * 0.5);
    }
  }

  // ── mid band: the headlands across the water, with gaps of open sea ───────
  // A bluff plus a narrower peak standing in FRONT of it and off to one side.
  // Behind, the peak is swallowed and every segment reads as a flat-topped
  // wall; in front, it breaks the skyline and the pair reads as a hill.
  const hills = layer(0x5a7a66, 0.5);
  const SEGMENTS = 52;
  for (let i = 0; i < SEGMENTS; i++) {
    // Three stretches of open water — a closed ring reads as a lake shore,
    // not as a coast with somewhere beyond it.
    const t = i / SEGMENTS;
    if ((t > 0.28 && t < 0.45) || (t > 0.60 && t < 0.68) || (t > 0.80 && t < 0.94)) continue;
    const a = t * Math.PI * 2;
    const r = 248 + rnd(i + 200) * 76;      // staggered depth, so they overlap
    const h = 5 + rnd(i + 240) ** 1.7 * 25; // mostly low, a few real headlands
    const w = 20 + rnd(i + 280) * 22;
    block(hills, a, r, w, h, 34);
    block(hills, a + (rnd(i + 320) - 0.5) * 0.10, r - 26,
          w * 0.42, h * (0.75 + rnd(i + 360) * 0.7), 26);
  }

  // ── far band: downtown, in one sector so it reads as a city ───────────────
  const city = layer(0x64769a, 0.62);
  const CITY_A = -0.62; // bearing of the skyline
  for (let i = 0; i < 40; i++) {
    const a = CITY_A + (i / 39 - 0.5) * 1.02;
    const r = 300 + rnd(i + 300) * 72;
    const w = 5 + rnd(i + 340) * 7;         // narrow: towers, not blocks
    const h = 14 + rnd(i + 380) ** 2.2 * 74; // a few stand well clear
    block(city, a, r, w, h, w);
  }
  // The two towers that make a skyline recognisable.
  block(city, CITY_A + 0.06, 316, 9, 104, 9);
  block(city, CITY_A - 0.17, 332, 7, 78, 7);

  return { group, layers };
}
