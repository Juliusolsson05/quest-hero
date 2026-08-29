import type { IslandView } from './world';

/**
 * Corner minimap: the island's tile grid pre-rendered once to an offscreen
 * canvas (1px per tile, crisp voxel look), with live dots for NPCs, the
 * summoned cart, remote players, and a heading arrow for the hero.
 */

const TILE_COLOR: Record<string, string> = {
  '~': '#7fd1e8', '.': '#8fd483', ',': '#c9a26b', ':': '#dcbb85',
  '#': '#cdd3d8', 's': '#f2e3b3', 'r': '#7d8090', 'b': '#e25b3d',
};

export interface MapDot { x: number; z: number; color: string }

export class Minimap {
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private size = 96;

  constructor() {
    document.body.insertAdjacentHTML('beforeend', `<canvas id="minimap" width="192" height="192"></canvas>`);
    this.cv = document.querySelector('#minimap')!;
    this.ctx = this.cv.getContext('2d')!;
  }

  bind(view: IslandView): void {
    const size = view.island.size;
    this.size = size;
    const base = document.createElement('canvas');
    base.width = size;
    base.height = size;
    const bctx = base.getContext('2d')!;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        bctx.fillStyle = TILE_COLOR[view.tileAt(x, z)] ?? '#8fd483';
        bctx.fillRect(x, z, 1, 1);
      }
    }
    this.base = base;
  }

  update(player: { x: number; z: number; rot: number }, npcs: MapDot[], cart: MapDot | null, remotes: MapDot[]): void {
    if (!this.base) return;
    const { ctx, cv } = this;
    const s = cv.width / this.size;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(this.base, 0, 0, cv.width, cv.height);

    const dot = (d: MapDot, r: number) => {
      ctx.beginPath();
      ctx.arc(d.x * s, d.z * s, r, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(53,49,63,.8)';
      ctx.stroke();
    };
    for (const n of npcs) dot(n, 2.4);
    for (const r of remotes) dot(r, 3);
    if (cart) dot(cart, 3.2);

    // the hero: a heading arrow (world yaw 0 faces +z / map-down)
    ctx.save();
    ctx.translate(player.x * s, player.z * s);
    ctx.rotate(-player.rot + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(4, 4.5);
    ctx.lineTo(0, 2.2);
    ctx.lineTo(-4, 4.5);
    ctx.closePath();
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#35313f';
    ctx.stroke();
    ctx.restore();
  }
}
