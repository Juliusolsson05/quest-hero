import type { Player } from './player';

/**
 * Touch controller — mounts only on coarse-pointer devices. A left-thumb
 * analog joystick strolls (push past ~80% to run); the rest of the screen
 * already orbits/pinches through Player's per-pointer camera handling, and
 * the interaction pill doubles as the tap target for E. Adds `touch` to
 * <body> so the stylesheet can compact the chrome around thumbs.
 */
export class TouchControls {
  readonly active: boolean;

  constructor(player: Player) {
    this.active = matchMedia('(pointer: coarse)').matches;
    if (!this.active) return;
    document.body.classList.add('touch');
    document.body.insertAdjacentHTML('beforeend', `
      <div id="joy" aria-hidden="true"><div class="joy-knob"></div></div>`);
    const ring = document.querySelector<HTMLElement>('#joy')!;
    const knob = ring.querySelector<HTMLElement>('.joy-knob')!;
    const R = 42; // knob travel radius, px

    let id: number | null = null;
    let cx = 0, cy = 0;
    const apply = (clientX: number, clientY: number) => {
      let dx = clientX - cx, dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      player.setMobileMove(dx / R, dy / R);
    };
    ring.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      // Capture keeps the thumb owned by the stick once it slides off the ring.
      // Safari can refuse for a pointer it no longer considers active — the
      // stick still tracks fine without it, so never let that throw kill it.
      try { ring.setPointerCapture(id); } catch { /* uncaptured is fine */ }
      const r = ring.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      apply(e.clientX, e.clientY);
      e.preventDefault();
    });
    ring.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) apply(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      player.setMobileMove(0, 0);
    };
    ring.addEventListener('pointerup', end);
    ring.addEventListener('pointercancel', end);
  }
}
