import * as THREE from 'three';
import type { BubbleMode, Emotion } from '../../shared/protocol';

/**
 * Kawaii speech bubbles: DOM overlay projected from 3D anchors, so text stays
 * crisp, selectable and easy to style. One bubble per speaker; streamed text
 * types out with a catch-up typewriter so it never trails the model by much.
 */

const EMOTION_ORNAMENT: Record<Emotion, string> = {
  happy: '✨', sad: '💧', shock: '❗', think: '💭', neutral: '',
};

interface Bubble {
  root: HTMLDivElement;
  name: HTMLDivElement;
  text: HTMLDivElement;
  full: string;      // text we want shown
  shown: number;     // chars currently revealed
  mode: BubbleMode;
  expireAt: number;  // performance.now() ms, Infinity = sticky
  lastFed: number;   // last push() — a stalled stream must not stick forever
  done: boolean;
}

export class Bubbles {
  private readonly layer: HTMLDivElement;
  private readonly bubbles = new Map<string, Bubble>();
  private readonly v = new THREE.Vector3();

  /** Speakers exempt from the distance filter (the boss): their bubble stays
   *  readable across the whole arena, and docks to the top of the screen
   *  instead of vanishing when the camera turns away. */
  readonly pinned = new Set<string>();

  constructor() {
    this.layer = document.createElement('div');
    this.layer.id = 'bubbles';
    document.body.append(this.layer);

    const style = document.createElement('style');
    style.textContent = `
      #bubbles { position: fixed; inset: 0; pointer-events: none; z-index: 12; overflow: hidden; }
      .bub { position: absolute; transform: translate(-50%, -100%); max-width: 300px;
        background: var(--bub, #fffdf6); border: 2.5px solid #35313f; border-radius: 18px;
        padding: 8px 14px 9px; font: 600 15px/1.35 "Baloo 2", "Trebuchet MS", sans-serif;
        color: #35313f; box-shadow: 0 5px 0 rgba(53,49,63,.14);
        transition: opacity .25s; animation: bub-in .28s cubic-bezier(.34,1.56,.64,1); }
      .bub::after { content: ""; position: absolute; left: 50%; bottom: -11px; width: 12px; height: 12px;
        background: inherit; border: 2.5px solid #35313f; border-top: none; border-left: none;
        transform: translateX(-50%) rotate(45deg); border-radius: 0 0 4px 0; }
      .bub .b-name { font-size: 11px; font-weight: 700; letter-spacing: .04em; opacity: .62;
        text-transform: uppercase; margin-bottom: 1px; }
      .bub .b-text { white-space: pre-wrap; word-break: break-word; }
      .bub.think .b-text::after { content: "…"; animation: dots 1.1s steps(4) infinite; }
      .bub.emo-shock { animation: bub-shake .3s; }
      .bub.fade { opacity: 0; }
      @keyframes bub-in { from { transform: translate(-50%,-100%) scale(.6); opacity: 0; } }
      @keyframes dots { 0% { content: ""; } 33% { content: "·"; } 66% { content: "··"; } 100% { content: "···"; } }
      @keyframes bub-shake { 25% { margin-left: -5px; } 75% { margin-left: 5px; } }
      @media (prefers-reduced-motion: reduce) { .bub { animation: none; } }`;
    document.head.append(style);
  }

  /** Feed from WS bubble frames (and locally for the player's own lines). */
  push(who: string, displayName: string, tint: string, mode: BubbleMode,
       text: string, emotion: Emotion): void {
    let b = this.bubbles.get(who);
    if (!b) {
      const root = document.createElement('div');
      root.className = 'bub';
      root.innerHTML = `<div class="b-name"></div><div class="b-text"></div>`;
      this.layer.append(root);
      b = { root, name: root.querySelector('.b-name')!, text: root.querySelector('.b-text')!,
            full: '', shown: 0, mode, expireAt: Infinity, lastFed: performance.now(), done: false };
      this.bubbles.set(who, b);
    }
    b.root.style.setProperty('--bub', tint || '#fffdf6');
    b.name.textContent = displayName;
    b.root.classList.toggle('think', mode === 'thinking' || mode === 'tool');
    b.root.classList.remove('fade');
    b.mode = mode;
    b.done = false;
    b.lastFed = performance.now();

    if (mode === 'thinking') { b.full = ''; b.shown = 0; b.text.textContent = ''; b.expireAt = Infinity; }
    else if (mode === 'tool') { b.full = ''; b.shown = 0; b.text.textContent = `📡 ${text || 'consulting the ravens'}`; b.expireAt = Infinity; }
    else if (mode === 'delta') { b.full = text; b.expireAt = Infinity; }
    else { // commit | ambient
      b.full = text + (EMOTION_ORNAMENT[emotion] && !/[✨💧❗💭]$/.test(text) ? ` ${EMOTION_ORNAMENT[emotion]}` : '');
      if (mode === 'ambient') { b.shown = b.full.length; b.text.textContent = b.full; }
      b.done = true;
      b.expireAt = performance.now() + Math.max(3200, b.full.length * 55);
      if (emotion === 'shock') {
        b.root.classList.remove('emo-shock');
        void b.root.offsetWidth; // restart the shake
        b.root.classList.add('emo-shock');
      }
    }
  }

  dismiss(who: string): void {
    const b = this.bubbles.get(who);
    if (b) b.expireAt = performance.now() + 400;
  }

  /** Call every frame: typewriter + projection + expiry. */
  update(dt: number, camera: THREE.PerspectiveCamera,
         anchorFor: (who: string) => THREE.Vector3 | null): void {
    const now = performance.now();
    for (const [who, b] of this.bubbles) {
      // A stream that stopped feeding (dead turn) winds down like a commit.
      if (!b.done && now - b.lastFed > 20_000) {
        b.done = true;
        b.expireAt = now + Math.max(2500, b.full.length * 50);
        b.root.classList.remove('think');
      }
      // typewriter catch-up: fast enough to never lag a stream badly
      if (b.shown < b.full.length) {
        b.shown = Math.min(b.full.length, b.shown + dt * (b.done ? 120 : 42));
        b.text.textContent = b.full.slice(0, Math.floor(b.shown));
      }
      if (now > b.expireAt) {
        b.root.classList.add('fade');
        if (now > b.expireAt + 300) { b.root.remove(); this.bubbles.delete(who); }
        continue;
      }
      const anchor = anchorFor(who);
      if (!anchor) { b.root.style.display = 'none'; continue; }
      const pinned = this.pinned.has(who);
      this.v.copy(anchor).project(camera);
      const behind = this.v.z > 1;
      const dist = camera.position.distanceTo(anchor);
      if (!pinned && (behind || dist > 26)) { b.root.style.display = 'none'; continue; }
      b.root.style.display = '';
      if (pinned && (behind || this.v.y > 0.9 || this.v.y < -0.9 || this.v.x > 1 || this.v.x < -1)) {
        // the speaker is off-screen; his words are not — dock as a subtitle
        b.root.style.left = '50%';
        b.root.style.top = '24%';
        b.root.style.transform = 'translate(-50%, -100%) scale(1)';
        b.root.style.opacity = '';
        continue;
      }
      b.root.style.left = `${(this.v.x * 0.5 + 0.5) * innerWidth}px`;
      b.root.style.top = `${(-this.v.y * 0.5 + 0.5) * innerHeight}px`;
      const s = pinned
        ? THREE.MathUtils.clamp(1.12 - dist * 0.022, 0.95, 1.05)
        : THREE.MathUtils.clamp(1.12 - dist * 0.022, 0.72, 1.05);
      b.root.style.transform = `translate(-50%, -100%) scale(${s})`;
      b.root.style.opacity = !pinned && dist > 20 ? '0.35' : '';
    }
  }
}
