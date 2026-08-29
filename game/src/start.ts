import qrcode from 'qrcode-generator';

/**
 * The title screen.
 *
 * The game boots, builds the city and renders behind this overlay from the
 * first frame — nothing here gates it. The overlay is only a lid, so the
 * "loading" bar reports asset streaming honestly and the click never waits.
 *
 * Leaving is one gesture: the pill splits down its seam, the two halves slide
 * apart, and the whole overlay falls into the gap. The gap is a real hole — a
 * pill-shaped clip punched out of .veil — so what shows through is the running
 * game, not a picture of it. Deliberately no shake and no squash: at this speed
 * any overshoot reads as a wobble rather than as weight.
 */


/** Rounded-pill path in the overlay's own pixel space, for the clip hole. */
function pillPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(h / 2, w / 2);
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
         `H${x + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

/** A short rising whoosh + a chime, so the door has some weight to it. */
function playLaunchSound(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const t = ac.currentTime;

    const sweep = ac.createOscillator();
    const sg = ac.createGain();
    sweep.type = 'sawtooth';
    sweep.frequency.setValueAtTime(90, t);
    sweep.frequency.exponentialRampToValueAtTime(720, t + 0.55);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.09, t + 0.1);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    sweep.connect(sg).connect(ac.destination);
    sweep.start(t);
    sweep.stop(t + 0.75);

    // a two-note sparkle on the door opening
    for (const [i, f] of [880, 1320].entries()) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const at = t + 0.34 + i * 0.08;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      o.connect(g).connect(ac.destination);
      o.start(at);
      o.stop(at + 0.5);
    }
    setTimeout(() => void ac.close(), 1600);
  } catch { /* audio is a garnish; never let it block the launch */ }
}

export class StartScreen {
  private root = document.getElementById('start') as HTMLElement;
  private veil = this.root.querySelector('.veil') as HTMLElement;
  private zoom = this.root.querySelector('.zoom') as HTMLElement;
  private btn = document.getElementById('startbtn') as HTMLElement;
  private lbl = document.getElementById('startlbl') as HTMLElement;
  private bar = document.getElementById('startbar') as HTMLElement;
  private doors = document.getElementById('doors') as HTMLElement;
  private launched = false;
  private isReady = false;

  /** Fired once the doors are open and the dive has begun. */
  onLaunch: () => void = () => {};

  constructor(private readonly coarse: boolean) {
    const bg = document.getElementById('startbg') as HTMLImageElement;
    const reveal = (): void => bg.classList.add('in');
    if (bg.complete) reveal();
    else {
      bg.addEventListener('load', reveal, { once: true });
      bg.addEventListener('error', () => bg.remove(), { once: true }); // gradient carries it
    }

    if (this.coarse) {
      (this.root.querySelector('.keys') as HTMLElement).textContent =
        'left stick to stroll (push far to run) · drag to look · pinch to zoom · tap the pill to talk · 📷 photo mode';
      (this.root.querySelector('.go') as HTMLElement).textContent = 'tap to step off the cable car ✨';
    }

    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.qr')) return; // the QR card is its own control
      this.launch();
    });
    addEventListener('keydown', (e) => {
      if (!this.launched && (e.code === 'Enter' || e.code === 'Space')) this.launch();
    });

    this.paintQr();
  }

  /** Asset streaming, 0..1. Honest progress — the world is already playable. */
  setProgress(f: number): void {
    if (this.isReady) return;
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;
  }

  /** Everything that was going to load has loaded (or given up). */
  ready(): void {
    if (this.isReady) return;
    this.isReady = true;
    this.bar.style.width = '100%';
    this.lbl.textContent = 'START';
    this.btn.classList.add('ready');
  }

  // ── the QR: hand this exact city to a phone ──────────────────────────────

  /** The link a phone should open. On localhost the page's own URL is useless
   *  to a phone, so point at the shipped build and keep the room code. */
  private inviteUrl(): string {
    const url = new URL(location.href);
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) {
      const live = new URL('https://sf-quest.vercel.app/');
      live.search = url.search;
      return live.toString();
    }
    return url.toString();
  }

  /** Re-cut the QR — the room code lands in the URL once Playroom connects. */
  paintQr(): void {
    const card = document.getElementById('qrcard') as HTMLElement | null;
    const slot = document.getElementById('qrimg') as HTMLElement | null;
    if (!card || !slot) return;
    const link = this.inviteUrl();
    try {
      slot.innerHTML = qrSvg(link);
    } catch {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const hint = document.getElementById('qrhint');
    if (hint) {
      hint.innerHTML = /vercel\.app/.test(link) && location.hostname !== 'sf-quest.vercel.app'
        ? 'scan — opens the <i>live</i> city'
        : 'scan — you land in <i>this</i> city';
    }
    card.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(link).then(() => {
        const b = card.querySelector('b') as HTMLElement;
        const was = b.textContent;
        b.textContent = 'link copied!';
        setTimeout(() => { b.textContent = was; }, 1600);
      }).catch(() => { /* clipboard is best-effort */ });
    };
  }

  // ── leaving ─────────────────────────────────────────────────────────────

  private launch(): void {
    if (this.launched) return;
    this.launched = true;

    // Pin the dive to the button and punch the doorway out of the overlay.
    const r = this.btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.zoom.style.transformOrigin = `${cx}px ${cy}px`;

    // Dress the doors as an exact copy of the button face, over the button.
    Object.assign(this.doors.style, {
      left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });

    playLaunchSound();

    // Punch the doorway in the same frame the doors go up: they cover it
    // exactly, so the hole (and the button vanishing into it) is invisible
    // until the halves slide apart. Firefox < 116 has no clip-path: path();
    // there the overlay simply fades on the dive, which still reads fine.
    try {
      this.veil.style.clipPath =
        `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z ${pillPath(r.left, r.top, r.width, r.height)}")`;
    } catch { /* no clip-path: path() — the dive's fade covers for it */ }

    this.root.classList.add('launching');

    setTimeout(() => this.onLaunch(), 400);
    setTimeout(() => {
      this.root.classList.add('hidden');
      this.veil.style.clipPath = '';
    }, 1300);
  }
}

// ── QR drawing ────────────────────────────────────────────────────────────

/**
 * Cut a QR by hand rather than using createSvgTag, so it can wear the kit:
 * dotted modules, rounded finder eyes, and a cream badge punched out of the
 * middle. Level H leaves ~30% of the symbol redundant, which pays for both
 * the rounding and the badge.
 */
function qrSvg(text: string): string {
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const pad = 2;
  const span = n + pad * 2;

  // Knock a hole in the middle for the badge (odd count, centred).
  const holeR = Math.floor(n * 0.11);
  const mid = (n - 1) / 2;
  const inHole = (r: number, c: number): boolean =>
    Math.abs(r - mid) <= holeR && Math.abs(c - mid) <= holeR;
  // The three finder eyes are drawn as shapes, so skip their modules.
  const inEye = (r: number, c: number): boolean =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inEye(r, c) || inHole(r, c)) continue;
      dots += `<rect x="${c + pad}" y="${r + pad}" width="1.04" height="1.04" rx=".3"/>`;
    }
  }

  // The eye ring is the only stroked shape here. It must NOT share a group with
  // the modules: a stroke inherited onto every 1-module rect fattens each one by
  // half a module on all sides and welds the whole symbol into an unreadable blob.
  let rings = '', cores = '';
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
    const x = c + pad, y = r + pad;
    rings += `<rect x="${x + .5}" y="${y + .5}" width="6" height="6" rx="2"/>`;
    cores += `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1.1"/>`;
  }

  const bx = mid + pad - holeR - 0.4;
  const bw = holeR * 2 + 1.8;
  const badge =
    `<rect x="${bx}" y="${bx}" width="${bw}" height="${bw}" rx="1.6" fill="#fffdf6" stroke="#35313f" stroke-width=".8"/>` +
    `<g transform="translate(${mid + pad + .5} ${mid + pad + .5}) scale(${bw / 26})" fill="none" stroke="#e2574f" ` +
    `stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M-10 6h20M-5.5 6V-7.6M5.5 6V-7.6"/>` +
    `<path d="M-10-.4c2.6 0 4.5-7.2 4.5-7.2S-3.2 1.6 0 1.6 5.5-7.6 5.5-7.6 7.4-.4 10-.4"/></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" shape-rendering="geometricPrecision" role="img" aria-label="Play on your phone">` +
         `<rect width="${span}" height="${span}" rx="2" fill="#fffdf6"/>` +
         `<g fill="#35313f">${dots}${cores}</g>` +
         `<g fill="none" stroke="#35313f" stroke-width="1">${rings}</g>${badge}</svg>`;
}

