import type { WeatherKind } from '../../../shared/protocol';
import { CARTS, type CartKind } from './carts';
import { esc } from '../util';

/**
 * The scrying glass — press P, or tap the bottom-right button. Cartly
 * ("carts, summoned") is the village ride-hailing app from the design kit
 * (design/RideRequest.dc.html + RideOnWay.dc.html), remapped onto the Tripo
 * fleet: the yellow taxi and the Waymo carts. A summon spawns a real cab in
 * taxi.ts; this file is only the glass. Fares surge with live hub weather.
 */

const ICONS: Record<CartKind, string> = {
  'taxi': `<svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
    <rect x="3" y="9" width="26" height="9" rx="3" fill="#ffd977" stroke="#35313f" stroke-width="2"/>
    <path d="M8 9 l3.5 -5 h9 l3.5 5" fill="#ffe08a" stroke="#35313f" stroke-width="2" stroke-linejoin="round"/>
    <rect x="13" y="1.5" width="6" height="3" rx="1" fill="#fffdf6" stroke="#35313f" stroke-width="1.6"/>
    <path d="M5 13.5 h4 M13 13.5 h4 M21 13.5 h4" stroke="#35313f" stroke-width="2.4" stroke-dasharray="2 2"/>
    <circle cx="10" cy="19.5" r="3.2" fill="#fffdf6" stroke="#35313f" stroke-width="2"/>
    <circle cx="24" cy="19.5" r="3.2" fill="#fffdf6" stroke="#35313f" stroke-width="2"/></svg>`,
  'waymo': `<svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
    <rect x="3" y="10" width="27" height="8.5" rx="4" fill="#fffdf6" stroke="#35313f" stroke-width="2"/>
    <path d="M8 10 q2 -5 8.5 -5 q6.5 0 8.5 5" fill="#e8f6f4" stroke="#35313f" stroke-width="2"/>
    <circle cx="16.5" cy="3.6" r="2.6" fill="#35313f"/><circle cx="16.5" cy="3.6" r="1" fill="#63bfae"/>
    <path d="M4.5 13 h5 M24 13 h5" stroke="#63bfae" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="10" cy="20" r="3.2" fill="#fffdf6" stroke="#35313f" stroke-width="2"/>
    <circle cx="24" cy="20" r="3.2" fill="#fffdf6" stroke="#35313f" stroke-width="2"/></svg>`,
  'waymo-xl': `<svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
    <path d="M3 18 v-8 q0 -6 7 -6 h13 q7 0 7 6 v8 Z" fill="#fffdf6" stroke="#35313f" stroke-width="2" stroke-linejoin="round"/>
    <rect x="7" y="7" width="7" height="5" rx="1.5" fill="#e8f6f4" stroke="#35313f" stroke-width="1.6"/>
    <rect x="17" y="7" width="7" height="5" rx="1.5" fill="#e8f6f4" stroke="#35313f" stroke-width="1.6"/>
    <circle cx="16" cy="2.8" r="2.4" fill="#35313f"/><circle cx="16" cy="2.8" r=".9" fill="#63bfae"/>
    <circle cx="10" cy="20" r="3.2" fill="#fffdf6" stroke="#35313f" stroke-width="2"/>
    <circle cx="24" cy="20" r="3.2" fill="#fffdf6" stroke="#35313f" stroke-width="2"/></svg>`,
};

const AVATARS: Record<CartKind, string> = {
  'taxi': `<svg width="46" height="46" viewBox="0 0 52 52"><circle cx="26" cy="27" r="21" fill="#e8c9a0" stroke="#35313f" stroke-width="2.5"/><path d="M10 30 q4 10 16 10 q12 0 16 -10 v6 q-5 9 -16 9 q-11 0 -16 -9 Z" fill="#cdd3d8" stroke="#35313f" stroke-width="2"/><ellipse cx="26" cy="12" rx="17" ry="6" fill="#ffe08a" stroke="#35313f" stroke-width="2.5"/><path d="M17 11 a9 7 0 0 1 18 0 Z" fill="#ffd977" stroke="#35313f" stroke-width="2.5"/><circle cx="20" cy="24" r="2" fill="#2c2833"/><circle cx="32" cy="24" r="2" fill="#2c2833"/><ellipse cx="15.5" cy="29" rx="3" ry="2" fill="#ffb3ab"/><ellipse cx="36.5" cy="29" rx="3" ry="2" fill="#ffb3ab"/></svg>`,
  'waymo': `<svg width="46" height="46" viewBox="0 0 52 52"><circle cx="26" cy="27" r="21" fill="#f4fbf9" stroke="#35313f" stroke-width="2.5"/><circle cx="26" cy="10" r="4.5" fill="#35313f"/><circle cx="26" cy="10" r="1.8" fill="#63bfae"/><rect x="14" y="21" width="9" height="7" rx="3.5" fill="#35313f"/><rect x="29" y="21" width="9" height="7" rx="3.5" fill="#35313f"/><rect x="16.5" y="23" width="4" height="3" rx="1.5" fill="#8ff2dd"/><rect x="31.5" y="23" width="4" height="3" rx="1.5" fill="#8ff2dd"/><path d="M19 35 q7 5 14 0" stroke="#35313f" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>`,
  'waymo-xl': `<svg width="46" height="46" viewBox="0 0 52 52"><circle cx="26" cy="27" r="21" fill="#f4fbf9" stroke="#35313f" stroke-width="2.5"/><circle cx="26" cy="10" r="4.5" fill="#35313f"/><circle cx="26" cy="10" r="1.8" fill="#63bfae"/><rect x="14" y="21" width="9" height="7" rx="3.5" fill="#35313f"/><rect x="29" y="21" width="9" height="7" rx="3.5" fill="#35313f"/><rect x="16.5" y="23" width="4" height="3" rx="1.5" fill="#8ff2dd"/><rect x="31.5" y="23" width="4" height="3" rx="1.5" fill="#8ff2dd"/><path d="M18 35 q8 6 16 0" stroke="#35313f" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M40 14 l4 -4 M42 18 l5 -2" stroke="#63bfae" stroke-width="2" stroke-linecap="round"/></svg>`,
};

const RAVEN = `<svg width="12" height="10" viewBox="0 0 24 20" fill="#8d8496"><path d="M2 12 q6 -10 13 -8 l7 -2 -5 5 q3 8 -6 11 q-6 2 -9 -6 Z"/></svg>`;

export class CartlyPhone {
  private root: HTMLDivElement;
  private selected: CartKind = 'taxi';
  private surge = 0;
  private fares: Record<CartKind, number> = { 'taxi': 8, 'waymo': 11, 'waymo-xl': 14 };
  /** 'auto' (scenic default) or an NPC id — read by the cart at boarding time. */
  destination = 'auto';

  onSummon: (kind: CartKind) => void = () => {};
  onCancel: () => void = () => {};

  constructor() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="phone">
        <div class="ph-bezel"><div class="ph-screen">
          <div class="ph-status"><span class="ph-clock">--:--</span>
            <span class="ph-sig">${RAVEN.replace('#8d8496', '#35313f')}
              <i style="height:5px"></i><i style="height:8px"></i><i class="dim" style="height:11px"></i></span>
          </div>

          <div class="ph-page" data-page="request">
            <div class="ph-head">
              <span class="ph-logo">${ICONS['taxi']}</span>
              <span class="ph-brand"><b>cartly</b><i>carts, summoned</i></span>
            </div>
            <div class="ph-route">
              <span class="ph-dotline"></span>
              <div><span class="ph-dot"></span><b class="ph-from">the plaza</b><i>thou art here</i></div>
              <div><svg class="ph-pin" width="12" height="15" viewBox="0 0 14 17"><path d="M7 1 a6 6 0 0 1 6 6 c0 4 -6 9 -6 9 s-6 -5 -6 -9 a6 6 0 0 1 6 -6 Z" fill="#e2574f" stroke="#35313f" stroke-width="2"/></svg>
                <select class="ph-dest"><option value="auto">across the bay (scenic)</option></select>
              </div>
            </div>
            <div class="ph-label">choose thy cart</div>
            <div class="ph-rides"></div>
            <div class="ph-scried">${RAVEN} <span class="ph-scried-t">fares scried live from the streets of San Francisco</span></div>
            <button class="ph-summon">summon cart <span class="ph-fare-chip"></span></button>
          </div>

          <div class="ph-page" data-page="onway" hidden>
            <div class="ph-eta"><span class="ph-eta-icon"></span>
              <span><b class="ph-eta-t">thy cart arriveth…</b><i class="ph-eta-sub"></i></span>
            </div>
            <div class="ph-map">
              <svg viewBox="0 0 244 210" width="100%" height="100%">
                <path d="M-10 168 Q 52 152 104 158 T 254 144" stroke="#d9ecdf" stroke-width="30" fill="none"/>
                <path d="M122 210 Q 122 150 122 96 Q 122 56 122 20" stroke="#e2574f" stroke-width="3.5" stroke-dasharray="1 8" stroke-linecap="round" fill="none"/>
                <g stroke="#35313f" stroke-width="2.5" stroke-linejoin="round">
                  <rect x="28" y="52" width="34" height="24" rx="5" fill="#fff3dd"/>
                  <path d="M24 54 L45 38 L66 54 Q45 48 24 54 Z" fill="#f49b3d"/>
                  <rect x="176" y="120" width="30" height="22" rx="5" fill="#fffdf6"/>
                  <path d="M172 122 L191 106 L210 122 Q191 117 172 122 Z" fill="#ff9d96"/>
                  <circle cx="196" cy="52" r="10" fill="#a8e6cf"/>
                  <circle cx="42" cy="140" r="9" fill="#63bf95"/>
                </g>
                <path d="M96 186 h52 M104 196 h36" stroke="#e2574f" stroke-width="4" stroke-linecap="round" opacity=".55"/>
                <g><path d="M122 20 v-14" stroke="#35313f" stroke-width="3"/><path d="M122 6 l13 5 -13 5 Z" fill="#e2574f" stroke="#35313f" stroke-width="2" stroke-linejoin="round"/></g>
                <g class="ph-map-cart" style="transform: translate(105px, 150px)"></g>
              </svg>
            </div>
            <div class="ph-driver">
              <span class="ph-ava"></span>
              <span class="ph-driver-t"><b></b><i></i>
                <em><svg width="13" height="13" viewBox="0 0 24 24" fill="#ffd977" stroke="#35313f" stroke-width="1.8"><path d="M12 2.5 l2.6 6 6.4 .6 -4.8 4.3 1.4 6.3 -5.6 -3.3 -5.6 3.3 1.4 -6.3 -4.8 -4.3 6.4 -.6 Z"/></svg> <b class="ph-rate"></b></em>
              </span>
              <span class="ph-plate"></span>
            </div>
            <div class="ph-msg"><span>send a raven to the driver…</span>
              <button class="ph-msg-go">${RAVEN.replace('#8d8496', '#35313f')}</button></div>
            <div class="ph-foot"><span class="ph-foot-t"></span><button class="ph-cancel">cancel</button></div>
          </div>

          <div class="ph-bar"></div>
        </div></div>
      </div>
      <button id="phonebtn" title="the scrying glass"><span class="pb-key">P</span><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="3"/><path d="M10.5 18.5 h3"/></svg></button>`);
    this.root = document.querySelector('#phone')!;
    document.querySelector('#phonebtn')!.addEventListener('click', () => this.toggle());

    this.root.querySelector('.ph-summon')!.addEventListener('click', () => {
      this.showOnWay('summoning…');
      this.onSummon(this.selected);
    });
    this.root.querySelector('.ph-cancel')!.addEventListener('click', () => {
      this.onCancel();
      this.backToRequest();
      this.close();
    });
    this.root.querySelector('.ph-msg-go')!.addEventListener('click', () => {
      const sub = this.root.querySelector<HTMLElement>('.ph-eta-sub')!;
      sub.textContent = this.selected === 'taxi'
        ? 'Gideon says: „on my way, hold thy horses"'
        : 'the cart has no one to read thy raven';
    });
    this.root.querySelector<HTMLSelectElement>('.ph-dest')!.addEventListener('change', (e) => {
      this.destination = (e.target as HTMLSelectElement).value;
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.close();
    });
    this.renderRides();
  }

  /** Fill the destination picker: the scenic default plus every citizen to meet. */
  setDestinations(npcs: { id: string; label: string }[]): void {
    const sel = this.root.querySelector<HTMLSelectElement>('.ph-dest')!;
    const keep = this.destination;
    sel.innerHTML = `<option value="auto">across the bay (scenic)</option>` +
      npcs.map((n) => `<option value="${n.id}">meet ${esc(n.label)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'auto';
    this.destination = sel.value;
  }

  get open(): boolean { return this.root.classList.contains('on'); }

  toggle(): void { this.open ? this.close() : this.show(); }

  show(): void {
    // "scried live": fares wander a little every time the glass is raised
    for (const k of Object.keys(this.fares) as CartKind[]) {
      this.fares[k] = CARTS[k].fare + this.surge + Math.floor(Math.random() * 3) - 1;
    }
    this.renderRides();
    this.root.querySelector('.ph-clock')!.textContent =
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    this.root.classList.add('on');
  }

  close(): void { this.root.classList.remove('on'); }

  /** Live pickup label under "thou art here". */
  setFrom(label: string): void {
    this.root.querySelector('.ph-from')!.textContent = label;
  }

  /** Rainy hub weather = surge pricing. The joke writes itself. */
  setWeather(kind: WeatherKind): void {
    this.surge = kind === 'rain' || kind === 'storm' ? 2 : 0;
    this.root.querySelector('.ph-scried-t')!.textContent = this.surge
      ? 'rain over San Francisco — surge pricing, +2 gold 🌧'
      : 'fares scried live from the streets of San Francisco';
  }

  showOnWay(etaText: string): void {
    const spec = CARTS[this.selected];
    this.page('onway');
    this.root.querySelector<HTMLElement>('.ph-eta-t')!.textContent = etaText;
    this.root.querySelector<HTMLElement>('.ph-eta-sub')!.textContent =
      this.selected === 'taxi' ? 'Gideon floors it ✨' : 'no driver. no small talk. bliss.';
    this.root.querySelector('.ph-eta-icon')!.innerHTML = ICONS[this.selected];
    this.root.querySelector('.ph-ava')!.innerHTML = AVATARS[this.selected];
    const t = this.root.querySelector('.ph-driver-t')!;
    t.querySelector('b')!.textContent = spec.driver;
    t.querySelector('i')!.textContent = spec.sub;
    t.querySelector('.ph-rate')!.textContent = `${spec.rating} · ${spec.label}`;
    this.root.querySelector('.ph-plate')!.textContent = spec.plate;
    this.root.querySelector('.ph-map-cart')!.innerHTML = ICONS[this.selected];
    this.root.querySelector<HTMLElement>('.ph-foot-t')!.textContent =
      `${spec.label} · ${this.fares[this.selected]} gold · pay by pouch`;
  }

  setEta(seconds: number): void {
    if (this.root.querySelector<HTMLElement>('[data-page="onway"]')!.hidden) return;
    this.root.querySelector<HTMLElement>('.ph-eta-t')!.textContent =
      seconds > 1.5 ? `thy cart arriveth in ${Math.ceil(seconds)}s` : 'thy cart is here!';
    // cart glyph crawls up the dotted route as the real one drives in
    const p = Math.max(0, Math.min(1, 1 - seconds / 12));
    this.root.querySelector<SVGGElement>('.ph-map-cart')!
      .style.transform = `translate(105px, ${150 - p * 128}px)`;
  }

  arrived(label: string): void {
    this.root.querySelector<HTMLElement>('.ph-eta-t')!.textContent = `thy ${label} is here!`;
    this.root.querySelector<HTMLElement>('.ph-eta-sub')!.textContent = 'hop in — press E';
  }

  backToRequest(): void { this.page('request'); }

  private page(id: 'request' | 'onway'): void {
    for (const p of this.root.querySelectorAll<HTMLElement>('.ph-page'))
      p.hidden = p.dataset.page !== id;
  }

  private renderRides(): void {
    const wrap = this.root.querySelector('.ph-rides')!;
    wrap.innerHTML = '';
    const subs: Record<CartKind, string> = {
      'taxi': 'swift · honks in 8-bit',
      'waymo': 'drives itself · SF certified',
      'waymo-xl': 'roomy · 6 seats',
    };
    for (const k of Object.keys(CARTS) as CartKind[]) {
      const el = document.createElement('button');
      el.className = `ph-ride${k === this.selected ? ' on' : ''}`;
      el.innerHTML = `${ICONS[k]}
        <span class="ph-ride-t"><b>${CARTS[k].label}</b><i>${subs[k]}</i></span>
        <span class="ph-ride-p"><b>${this.fares[k]} gold</b><i>${k === 'taxi' ? '2' : k === 'waymo' ? '3' : '5'} min away</i></span>`;
      el.addEventListener('click', () => { this.selected = k; this.renderRides(); });
      wrap.append(el);
    }
    this.root.querySelector('.ph-fare-chip')!.textContent = `${this.fares[this.selected]} gold`;
  }
}

