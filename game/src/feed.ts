import type { TimeState, WeatherState, WorldEvent } from '../../shared/protocol';

/**
 * The city pulse — press L, or tap the button stacked above the scrying
 * glass. One panel with everything that just happened in town: the last
 * conversations (NPC and player bubbles) and the city record (quests,
 * weather, commits, animal drama), plus a live status strip. Seeded from the
 * welcome frame's recentEvents, then fed by live bubble/event frames.
 */

interface Entry {
  at: number;
  kind: 'talk' | 'city';
  icon: string;
  who?: string;
  tint?: string;
  text: string;
}

const EVENT_ICON: Record<WorldEvent['type'], string> = {
  'weather.changed': '🌦️', 'time.phase': '🕰️', 'npc.moved': '👣', 'npc.said': '💬',
  'npc.action': '👣', 'animal.action': '🐾', 'object.spawned': '✨', 'object.removed': '🍂',
  'quest.created': '📜', 'quest.accepted': '🤝', 'quest.step': '☑️', 'quest.completed': '🎉',
  'commit.landed': '📦', 'player.joined': '🚪', 'player.said': '💬', 'mcp.custom': '🛰️',
};

const MAX_ENTRIES = 140;

export class CityFeed {
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  private stats: HTMLDivElement;
  private entries: Entry[] = [];
  private filter: 'all' | 'talk' | 'city' = 'all';
  private seeded = false;
  private weather: WeatherState | null = null;
  private time: TimeState | null = null;
  private npcCount = 0;
  private questCount = 0;

  constructor() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="feedpanel">
        <div class="f-head">🌉 city pulse <button class="f-close">✕</button></div>
        <div class="f-stats"></div>
        <div class="f-tabs">
          <button data-f="all" class="on">all</button>
          <button data-f="talk">chats</button>
          <button data-f="city">city</button>
        </div>
        <div class="f-list"></div>
      </div>
      <button id="feedbtn" title="the city pulse"><span class="pb-key">L</span>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 5.5 h13 a2.5 2.5 0 0 1 2.5 2.5 v5 a2.5 2.5 0 0 1 -2.5 2.5 h-7.5 l-4 3.5 v-3.5 h-1.5 a2.5 2.5 0 0 1 -2.5 -2.5 v-5 a2.5 2.5 0 0 1 2.5 -2.5 Z"/>
          <path d="M8 10 h8 M8 13 h5"/>
        </svg>
      </button>`);
    this.root = document.querySelector('#feedpanel')!;
    this.list = this.root.querySelector('.f-list')!;
    this.stats = this.root.querySelector('.f-stats')!;
    document.querySelector('#feedbtn')!.addEventListener('click', () => this.toggle());
    this.root.querySelector('.f-close')!.addEventListener('click', () => this.close());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.f-tabs button')) {
      b.addEventListener('click', () => {
        this.filter = b.dataset.f as typeof this.filter;
        for (const o of this.root.querySelectorAll('.f-tabs button')) o.classList.toggle('on', o === b);
        this.render();
      });
    }
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.close();
    });
  }

  get open(): boolean { return this.root.classList.contains('on'); }
  toggle(): void { this.open ? this.close() : this.show(); }
  show(): void { this.root.classList.add('on'); this.render(); }
  close(): void { this.root.classList.remove('on'); }

  /** History from the welcome frame — once; reconnects don't duplicate it. */
  seed(events: WorldEvent[]): void {
    if (this.seeded) return;
    this.seeded = true;
    for (const e of events) this.pushEvent(e, false);
    this.render();
  }

  /** A live speech bubble (NPC or the player). */
  addTalk(who: string, tint: string, text: string): void {
    this.push({ at: Date.now(), kind: 'talk', icon: '💬', who, tint, text });
  }

  /** A live world event. */
  addEvent(e: WorldEvent): void { this.pushEvent(e, true); }

  private pushEvent(e: WorldEvent, live: boolean): void {
    // Live npc.said/player.said duplicate the bubble frames — skip those; the
    // seeded history keeps them (it's the only record of older chatter).
    if (live && (e.type === 'npc.said' || e.type === 'player.said')) return;
    this.push({
      at: e.at,
      kind: e.type === 'npc.said' || e.type === 'player.said' ? 'talk' : 'city',
      icon: EVENT_ICON[e.type] ?? '✨',
      text: e.summary,
    });
  }

  private push(entry: Entry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    if (this.open) this.render();
  }

  setWeather(w: WeatherState): void { this.weather = w; if (this.open) this.renderStats(); }
  setTime(t: TimeState): void { this.time = t; if (this.open) this.renderStats(); }
  setCounts(npcs: number, quests: number): void {
    this.npcCount = npcs;
    this.questCount = quests;
    if (this.open) this.renderStats();
  }

  private renderStats(): void {
    const w = this.weather;
    const t = this.time;
    const hh = t ? `${String(Math.floor(t.hour)).padStart(2, '0')}:${String(Math.floor((t.hour % 1) * 60)).padStart(2, '0')}` : '--:--';
    this.stats.innerHTML = `
      <span>${w ? `${w.kind} · ${Math.round(w.tempC)}°C` : '…'}</span>
      <span>🕐 ${hh}</span>
      <span>🏘️ ${this.npcCount} citizens</span>
      <span>📜 ${this.questCount} quests</span>`;
  }

  private render(): void {
    this.renderStats();
    const shown = this.entries.filter((e) => this.filter === 'all' || e.kind === this.filter);
    if (!shown.length) {
      this.list.innerHTML = `<div class="f-empty">All quiet in the city so far… 🌫️</div>`;
      return;
    }
    this.list.replaceChildren();
    for (const e of [...shown].reverse()) {
      const el = document.createElement('div');
      el.className = `f-item ${e.kind}`;
      const whoHtml = e.who
        ? `<b class="f-who" style="background:${escAttr(e.tint ?? '#fffdf6')}">${esc(e.who)}</b> `
        : '';
      el.innerHTML = `
        <span class="f-icon">${e.icon}</span>
        <span class="f-body">${whoHtml}${esc(e.text)}</span>
        <span class="f-when">${ago(e.at)}</span>`;
      this.list.append(el);
    }
  }
}

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : '#fffdf6';
}
