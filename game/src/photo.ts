import * as THREE from 'three';
import { aimAt, buildSubjects, districtSubject, type Subject } from './landmarks';
import { fetchDossier } from './lens';
import type { Player } from './player';
import type { IslandView } from './world';

/**
 * Photo mode — press C, and the camera drops into the hero's eyes.
 *
 * You look around, frame a building, and take the picture. What comes back is
 * not a caption we wrote: the shot's subject is resolved to a real San
 * Francisco building (game/src/landmarks.ts), handed to an agent on the
 * TrueForge harness with the `sf-guide` MCP server attached, and the agent goes
 * and reads the city's own live data about it — DataSF's landmark register,
 * film locations, business filings, 311, Muni, NOAA tides, today's weather.
 * The tool calls stream into the card as it makes them, so the player watches
 * the lookup happen rather than waiting at a spinner.
 *
 * The three pieces, kept apart on purpose:
 *   landmarks.ts  which building is that (geometry → identity)
 *   lens.ts       how the question reaches the harness (hub, or direct)
 *   photo.ts      the viewfinder, the shutter, and the card (this file)
 */

/** How often the aim readout re-resolves. Twelve times a second is faster than
 *  anyone pans a camera and a fraction of the cost of doing it per frame. */
const AIM_MS = 80;

/** Tool-call badges kept on screen at once; older ones collapse to a count. */
const TOOLS_SHOWN = 6;

/** Shots kept in the roll. The roll is memory only — a photograph outlives the
 *  page if the player saves it. */
const ROLL_MAX = 8;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

interface Fact { text: string; source: string }

interface Shot {
  id: number;
  image: string;
  subject: Subject;
  distanceM: number;
  bearing: string;
  focalMm: number;
  /** Raw agent output, kept so a re-render never loses what already arrived. */
  raw: string;
  tools: string[];
  /** Has anything at all come back from the harness yet? */
  live: boolean;
  state: 'pending' | 'done' | 'failed';
  error?: string;
  abort: AbortController;
}

export class PhotoMode {
  private readonly overlay: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly nameEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly lensEl: HTMLElement;
  private readonly rollEl: HTMLElement;
  private readonly frameEl: HTMLElement;

  private subjects: Subject[] = [];
  private island: IslandView | null = null;
  private aim: { subject: Subject; distance: number } | null = null;
  private aimAt_ = 0;
  private pending = false;
  private shots: Shot[] = [];
  private shown: Shot | null = null;
  private seq = 0;

  /** Fired when the mode opens or closes, so the caller can put the rest of
   *  the HUD away and stop feeding it interaction prompts. */
  onToggle: (on: boolean) => void = () => {};

  constructor(private readonly player: Player) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="photo">
        <div class="pm-bar pm-top">
          <span class="pm-rec">● PHOTO MODE</span>
          <span class="pm-lens">40mm</span>
          <span class="pm-hint">drag to look · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · wheel zooms · <kbd>space</kbd> shoot</span>
          <button class="pm-exit" title="leave photo mode (C)">✕</button>
        </div>
        <div class="pm-frame">
          <i class="pm-c tl"></i><i class="pm-c tr"></i><i class="pm-c bl"></i><i class="pm-c br"></i>
          <div class="pm-retic"></div>
        </div>
        <div class="pm-bar pm-bottom">
          <div class="pm-subject"><b class="pm-name">nothing in frame</b><span class="pm-dist"></span></div>
          <button class="pm-shoot" title="take the photograph"><span></span></button>
          <div class="pm-roll"></div>
        </div>
        <div class="pm-flash"></div>
      </div>
      <div id="photocard">
        <div class="pc-head">📸 <span class="pc-title">…</span><button class="pc-close">✕</button></div>
        <div class="pc-body">
          <img class="pc-shot" alt="the photograph you just took" />
          <div class="pc-meta"></div>
          <div class="pc-tools"></div>
          <div class="pc-caption"></div>
          <div class="pc-facts"></div>
          <div class="pc-foot"></div>
        </div>
      </div>
      <button id="photobtn" title="photo mode"><span class="pb-key">C</span>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8.5h3.2l1.6-2.4h8.4l1.6 2.4H21a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/>
          <circle cx="12" cy="13.5" r="3.6"/>
        </svg>
      </button>`);

    this.overlay = document.querySelector('#photo')!;
    this.card = document.querySelector('#photocard')!;
    this.nameEl = this.overlay.querySelector('.pm-name')!;
    this.distEl = this.overlay.querySelector('.pm-dist')!;
    this.lensEl = this.overlay.querySelector('.pm-lens')!;
    this.rollEl = this.overlay.querySelector('.pm-roll')!;
    this.frameEl = this.overlay.querySelector('.pm-frame')!;

    document.querySelector('#photobtn')!.addEventListener('click', () => this.toggle());
    this.overlay.querySelector('.pm-shoot')!.addEventListener('click', () => this.shoot());
    this.overlay.querySelector('.pm-exit')!.addEventListener('click', () => this.close());
    this.card.querySelector('.pc-close')!.addEventListener('click', () => this.closeCard());

    // Same dismissal rule as the other panels: click away and it goes. Never
    // while the viewfinder is open, where a click is the start of a camera
    // drag rather than a decision about the card.
    document.addEventListener('pointerdown', (e) => {
      if (this.active) return;
      if (this.card.classList.contains('on') && !this.card.contains(e.target as Node)) this.closeCard();
    });

    addEventListener('keydown', (e) => {
      if (document.body.dataset.typing === '1') return;
      if (e.code === 'KeyC') { e.preventDefault(); this.toggle(); return; }
      if (!this.active) return;
      // Space is the shutter here rather than a jump — the Player skips its
      // hop while photo mode is on, so the two never fire together.
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.shoot(); return; }
      if (e.code === 'Escape') this.close();
    });
  }

  get active(): boolean { return this.overlay.classList.contains('on'); }

  /** The city, once it exists — every photographable building on the map. */
  bind(island: IslandView): void {
    this.island = island;
    this.subjects = buildSubjects(island.island);
  }

  toggle(): void { this.active ? this.close() : this.open(); }

  open(): void {
    if (this.active || !this.island) return;
    this.overlay.classList.add('on');
    document.body.classList.add('photo');
    this.player.setPhotoMode(true);
    this.aim = null;
    this.aimAt_ = 0;
    this.paintAim();
    this.onToggle(true);
  }

  close(): void {
    if (!this.active) return;
    this.overlay.classList.remove('on');
    document.body.classList.remove('photo');
    this.player.setPhotoMode(false);
    this.onToggle(false);
  }

  /** Per-frame: keep the readout honest about what the lens is pointed at. */
  update(): void {
    if (!this.active || !this.island) return;
    const lens = `${focalMm(this.player.photoFov)}mm`;
    if (this.lensEl.textContent !== lens) this.lensEl.textContent = lens; // no per-frame reflow
    const now = performance.now();
    if (now - this.aimAt_ < AIM_MS) return;
    this.aimAt_ = now;

    const cam = this.player.camera.position;
    const hit = aimAt(
      this.subjects, cam, this.player.viewDir(),
      THREE.MathUtils.degToRad(this.player.photoFov), this.island,
    );
    this.aim = hit ? { subject: hit.subject, distance: hit.distance } : null;
    this.paintAim();
  }

  private paintAim(): void {
    const locked = !!this.aim;
    this.frameEl.classList.toggle('locked', locked);
    this.nameEl.textContent = this.aim ? this.aim.subject.name : 'nothing in frame — point at a building';
    this.distEl.textContent = this.aim
      ? `${this.aim.subject.where} · ${Math.round(this.aim.distance)}m`
      : '';
  }

  /**
   * Take the picture. The pixels can only be read on the frame they were
   * drawn, so the shutter only *arms* here and `capture()` fires from the
   * render loop.
   */
  private shoot(): void {
    if (!this.active || this.pending) return;
    this.pending = true;
    this.overlay.classList.add('flash');
    setTimeout(() => this.overlay.classList.remove('flash'), 260);
  }

  /**
   * Called by the render loop immediately after the frame is drawn: the
   * drawing buffer is cleared before the next one, so a canvas read one tick
   * later comes back blank.
   */
  capture(canvas: HTMLCanvasElement): void {
    if (!this.pending) return;
    this.pending = false;

    const w = Math.min(720, canvas.width);
    const h = Math.round((w * canvas.height) / canvas.width);
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    off.getContext('2d')?.drawImage(canvas, 0, 0, w, h);

    // Nothing recognisable in frame is still a photograph of somewhere real —
    // the district itself becomes the subject rather than the shot being lost.
    const subject = this.aim?.subject
      ?? districtSubject(this.player.pos.x, this.player.pos.z);
    const shot: Shot = {
      id: ++this.seq,
      image: off.toDataURL('image/jpeg', 0.85),
      subject,
      distanceM: this.aim?.distance ?? 0,
      bearing: bearingOf(this.player.viewDir()),
      focalMm: focalMm(this.player.photoFov),
      raw: '',
      tools: [],
      live: false,
      state: 'pending',
      abort: new AbortController(),
    };
    this.shots.unshift(shot);
    for (const dropped of this.shots.splice(ROLL_MAX)) dropped.abort.abort();
    this.paintRoll();
    this.show(shot);
    void this.develop(shot);
  }

  /** Hand the shot to the harness and stream the answer into its card. */
  private async develop(shot: Shot): Promise<void> {
    let painted = 0;
    try {
      await fetchDossier(
        shot.subject,
        { distanceM: shot.distanceM, bearing: shot.bearing, focalMm: shot.focalMm },
        {
          onLive: () => { shot.live = true; if (this.shown === shot) this.paintCard(); },
          onTool: (label) => {
            shot.tools.push(label);
            if (this.shown === shot) this.paintCard();
          },
          onDelta: (text) => {
            shot.raw += text;
            // Repaint at reading speed, not at token speed.
            const now = performance.now();
            if (this.shown === shot && now - painted > 90) { painted = now; this.paintCard(); }
          },
        },
        shot.abort.signal,
      );
      shot.state = 'done';
    } catch (e) {
      // Anything that arrived before the failure is kept: half a dossier of
      // real data beats an error message that throws it away.
      shot.state = shot.raw.trim() ? 'done' : 'failed';
      shot.error = e instanceof Error ? e.message : String(e);
    }
    if (this.shown === shot) this.paintCard();
  }

  // ── the card ──────────────────────────────────────────────────────────────

  private show(shot: Shot): void {
    this.shown = shot;
    this.card.classList.add('on');
    this.paintCard();
  }

  closeCard(): void {
    this.card.classList.remove('on');
    this.shown = null;
  }

  private paintCard(): void {
    const shot = this.shown;
    if (!shot) return;
    const { caption, facts } = parseDossier(shot.raw);

    this.card.querySelector('.pc-title')!.textContent = shot.subject.name;
    (this.card.querySelector('.pc-shot') as HTMLImageElement).src = shot.image;
    this.card.querySelector('.pc-meta')!.innerHTML =
      `<span>${esc(shot.subject.where)}</span><span>${esc(shot.subject.district)}</span>` +
      `<span>${shot.subject.lat.toFixed(4)}, ${shot.subject.lon.toFixed(4)}</span>` +
      `<span>${shot.focalMm}mm · facing ${esc(shot.bearing)}</span>`;

    // Tool calls, newest last: the visible record of where each fact came from.
    // Only the tail is shown — a thorough hunt through the datasets can run to
    // a dozen queries, and the dossier itself should not be pushed off screen.
    const tools = this.card.querySelector('.pc-tools')!;
    const earlier = Math.max(0, shot.tools.length - TOOLS_SHOWN);
    tools.innerHTML = (earlier ? `<span class="pc-tool">+${earlier} earlier</span>` : '')
      + shot.tools.slice(-TOOLS_SHOWN).map((t) => `<span class="pc-tool">${esc(t)}</span>`).join('')
      + (shot.state === 'pending'
        ? `<span class="pc-tool live">${shot.tools.length ? 'reading the city…' : 'asking the city archive…'}</span>`
        : '');

    this.card.querySelector('.pc-caption')!.textContent = caption;
    const list = this.card.querySelector('.pc-facts')!;
    list.innerHTML = facts
      .map((f) => `<div class="pc-fact">${esc(f.text)}${f.source ? `<span class="pc-src">${esc(f.source)}</span>` : ''}</div>`)
      .join('');

    const foot = this.card.querySelector('.pc-foot')!;
    if (shot.state === 'failed') {
      foot.innerHTML = `<span class="pc-warn">no live data: ${esc(shot.error ?? 'the archive is out of reach')}</span>`
        + `<button class="pc-save">save photo</button>`;
    } else {
      const via = shot.live ? 'live from World Hub → TrueForge · sf-guide' : 'reaching the harness…';
      foot.innerHTML = `<span class="pc-via">${esc(via)}</span><button class="pc-save">save photo</button>`;
    }
    foot.querySelector('.pc-save')!.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = shot.image;
      a.download = `sf-quest-${shot.subject.id.replace(/[^a-z0-9]+/gi, '-')}-${shot.id}.jpg`;
      a.click();
    });
  }

  private paintRoll(): void {
    this.rollEl.replaceChildren();
    for (const shot of this.shots) {
      const img = document.createElement('img');
      img.src = shot.image;
      img.className = 'pm-thumb';
      img.title = shot.subject.name;
      img.addEventListener('click', () => this.show(shot));
      this.rollEl.append(img);
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Vertical FOV → 35mm-equivalent focal length, for a readout a photographer
 *  can read. 24mm of frame height is the full-frame convention. */
function focalMm(fovDeg: number): number {
  return Math.round(12 / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
}

function bearingOf(dir: THREE.Vector3): string {
  // North is -z on this map: the Marin headland is at the top of the grid.
  const deg = ((Math.atan2(dir.x, -dir.z) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/**
 * The agent answers as `CAPTION: …` then `- fact — source: dataset` lines.
 * Parsed leniently and re-parsed on every delta, so a half-written line shows
 * as it is typed rather than appearing only once it is complete.
 */
function parseDossier(raw: string): { caption: string; facts: Fact[] } {
  let caption = '';
  const facts: Fact[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^caption\s*:/i.test(t)) { caption = t.replace(/^caption\s*:/i, '').trim(); continue; }
    if (!/^[-•*]\s+/.test(t)) {
      // A model that skipped the CAPTION: label still wrote a caption.
      if (!caption && !facts.length) caption = t;
      continue;
    }
    const body = t.replace(/^[-•*]\s+/, '');
    const m = /\s[—–-]\s*source\s*:\s*(.+)$/i.exec(body);
    facts.push(m
      ? { text: body.slice(0, m.index).trim(), source: m[1].trim().replace(/[.\s]+$/, '') }
      : { text: body, source: '' });
  }
  return { caption, facts };
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
