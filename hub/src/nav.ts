/**
 * Hub-only NPC navigation over the shared island. Lives in the hub (not in
 * shared/) because only the authoritative sim routes NPCs — the client just
 * renders the poses it is sent, so shipping BFS to the browser would be dead
 * weight and a temptation to fork movement logic.
 */
import { heightAt, island } from '../../shared/island';
import type { Vec3 } from '../../shared/protocol';

const SIZE = island.size;

// A tile is navigable when it's land (roads and sidewalks very much included)
// and its centre keeps a little clearance from every building footprint, so
// BFS paths thread the streets and the gaps between houses instead of steering
// blindly into a wall.
const NAV: Uint8Array = (() => {
  const nav = new Uint8Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++)
      if (island.tiles[z][x] !== '~') nav[z * SIZE + x] = 1;
  for (const o of island.blockers) {
    const pad = o.r + 0.25;
    for (let z = Math.floor(o.z - pad); z <= Math.ceil(o.z + pad); z++) {
      for (let x = Math.floor(o.x - pad); x <= Math.ceil(o.x + pad); x++) {
        if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) continue;
        if (Math.hypot(x + 0.5 - o.x, z + 0.5 - o.z) < pad) nav[z * SIZE + x] = 0;
      }
    }
  }
  return nav;
})();

/** Nearest navigable tile index to (x, z) within a few tiles, or -1. */
function nearestNav(x: number, z: number): number {
  const tx = Math.floor(x), tz = Math.floor(z);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = tx + dx, nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE || !NAV[nz * SIZE + nx]) continue;
      const d = (nx + 0.5 - x) ** 2 + (nz + 0.5 - z) ** 2;
      if (d < bestD) { bestD = d; best = nz * SIZE + nx; }
    }
  }
  return best;
}

/**
 * BFS route over the nav grid from `from` to `to`: corner waypoints at tile
 * centres, ending with the exact destination. Null when nothing connects them
 * (caller falls back to straight-line steering).
 */
export function findPath(from: Vec3, to: Vec3): Vec3[] | null {
  const start = nearestNav(from.x, from.z);
  const goal = nearestNav(to.x, to.z);
  if (start < 0 || goal < 0) return null;
  const exact: Vec3 = { x: to.x, y: heightAt(to.x, to.z), z: to.z };
  if (start === goal) return [exact];
  const prev = new Int32Array(SIZE * SIZE).fill(-1);
  prev[start] = start;
  const q = [start];
  for (let qi = 0; qi < q.length && prev[goal] === -1; qi++) {
    const cur = q[qi];
    const cx = cur % SIZE;
    for (const n of [cur - 1, cur + 1, cur - SIZE, cur + SIZE]) {
      if (n < 0 || n >= SIZE * SIZE || Math.abs((n % SIZE) - cx) > 1) continue;
      if (!NAV[n] || prev[n] !== -1) continue;
      prev[n] = cur;
      q.push(n);
    }
  }
  if (prev[goal] === -1) return null;
  const cells: [number, number][] = [];
  for (let cur = goal; ; cur = prev[cur]) {
    cells.push([cur % SIZE, Math.floor(cur / SIZE)]);
    if (prev[cur] === cur) break;
  }
  cells.reverse();
  const wp: Vec3[] = [];
  for (let i = 1; i < cells.length; i++) { // skip the start cell
    if (i < cells.length - 1) { // keep corners, drop straightaways
      const [ax, az] = cells[i - 1], [bx, bz] = cells[i], [cx2, cz2] = cells[i + 1];
      if (bx - ax === cx2 - bx && bz - az === cz2 - bz) continue;
    }
    const px = cells[i][0] + 0.5, pz = cells[i][1] + 0.5;
    wp.push({ x: px, y: heightAt(px, pz), z: pz });
  }
  wp.push(exact);
  return wp;
}
