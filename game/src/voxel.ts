import * as THREE from 'three';

/**
 * The one voxel-shading trick behind everything in the game: a box with
 * per-face vertex shading baked in — bright top, dimmer sides, darkest
 * bottom. Multiplied with material/instance colour it gives the clean
 * "voxel" read without any lighting tricks. The shade constants stay with
 * each caller (terrain, characters, the arena) — they are deliberate
 * per-domain contrast choices, not copies to reconcile.
 */
export interface BoxShades {
  top: number;
  bottom: number;
  sideX: number;
  sideZ: number;
}

export function shadedBox(w: number, h: number, d: number, s: BoxShades): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const n = g.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i), nx = n.getX(i);
    const v = ny > 0.5 ? s.top : ny < -0.5 ? s.bottom : Math.abs(nx) > 0.5 ? s.sideX : s.sideZ;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
