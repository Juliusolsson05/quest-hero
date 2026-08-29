import type { Quest, TimeState, WeatherState } from '../../shared/protocol';
import { esc } from './util';

/** HUD: weather/time chips, event toasts, the talk bar, and the quest board. */

const WEATHER_ICON: Record<string, string> = {
  clear: '☀️', clouds: '☁️', rain: '🌧️', fog: '🌫️', snow: '❄️', storm: '⛈️',
};
const PHASE_ICON: Record<string, string> = { dawn: '🌅', day: '☀️', dusk: '🌇', night: '🌙' };

export class Ui {
  private readonly weatherChip: HTMLSpanElement;
  private readonly timeChip: HTMLSpanElement;
  private readonly linkChip: HTMLSpanElement;
  private readonly toasts: HTMLDivElement;
  private readonly talk: HTMLDivElement;
  private readonly talkWho: HTMLDivElement;
  private readonly talkInput: HTMLInputElement;
  private readonly prompt: HTMLDivElement;
  private readonly questPanel: HTMLDivElement;
  private quests: Quest[] = [];
  private talkTarget: string | null = null;

  onSay: (npcId: string, text: string) => void = () => {};
  onAccept: (questId: string) => void = () => {};
  /** Tapping the interaction pill = pressing E (the touch path). */
  onPromptTap: () => void = () => {};

  constructor() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="hud">
        <span class="chip" id="c-weather">…</span>
        <span class="chip" id="c-time">…</span>
        <span class="chip dim" id="c-link">connecting…</span>
      </div>
      <div id="toasts"></div>
      <div id="prompt"></div>
      <div id="talkbar">
        <div class="t-who"></div>
        <input class="t-input" placeholder="Say something… (Esc to wave bye)" autocomplete="off" />
      </div>
      <div id="questpanel">
        <div class="q-head">📋 Notice board <button class="q-close">✕</button></div>
        <div class="q-list"></div>
      </div>`);
    this.weatherChip = document.querySelector('#c-weather')!;
    this.timeChip = document.querySelector('#c-time')!;
    this.linkChip = document.querySelector('#c-link')!;
    this.toasts = document.querySelector('#toasts')!;
    this.prompt = document.querySelector('#prompt')!;
    this.talk = document.querySelector('#talkbar')!;
    this.talkWho = this.talk.querySelector('.t-who')!;
    this.talkInput = this.talk.querySelector('.t-input')!;
    this.questPanel = document.querySelector('#questpanel')!;

    this.talkInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeTalk();
      if (e.key === 'Enter' && this.talkInput.value.trim() && this.talkTarget) {
        this.onSay(this.talkTarget, this.talkInput.value.trim());
        this.talkInput.value = '';
      }
    });
    this.questPanel.querySelector('.q-close')!.addEventListener('click', () => this.closeQuests());
    this.prompt.addEventListener('click', () => this.onPromptTap());

    // Clicking anywhere outside a panel dismisses it — no hunting for ✕ / Esc.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.talkTarget && !this.talk.contains(t)) this.closeTalk();
      if (this.questsOpen && !this.questPanel.contains(t)) this.closeQuests();
    });
  }

  setLink(ok: boolean, lonely = false): void {
    // `lonely` = we've waited long enough that no hub is coming (static-host
    // demo): the city runs, citizens sleep, multiplayer still works.
    this.linkChip.textContent = ok ? '🟢 hub' : lonely ? '🌁 solo city — citizens asleep' : '⚪ waking the city…';
    this.linkChip.classList.toggle('dim', !ok);
  }
  setWeather(w: WeatherState): void {
    this.weatherChip.textContent = `${WEATHER_ICON[w.kind] ?? ''} ${w.kind} ${Math.round(w.tempC)}°C${w.real ? '' : ' (override)'}`;
    this.weatherChip.title = w.summary;
  }
  setTime(t: TimeState): void {
    const hh = String(Math.floor(t.hour)).padStart(2, '0');
    const mm = String(Math.floor((t.hour % 1) * 60)).padStart(2, '0');
    this.timeChip.textContent = `${PHASE_ICON[t.phase] ?? ''} ${hh}:${mm}${t.real ? ' SF' : ''}`;
  }

  toast(text: string, icon = '✨'): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = `${icon} ${text}`;
    this.toasts.prepend(el);
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5600);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
  }

  setPrompt(html: string | null): void {
    if (html) { this.prompt.innerHTML = html; this.prompt.classList.add('on'); }
    else this.prompt.classList.remove('on');
  }

  // ── talk bar ──
  get talking(): string | null { return this.talkTarget; }
  openTalk(npcId: string, label: string): void {
    this.talkTarget = npcId;
    this.talkWho.textContent = label;
    this.talk.classList.add('on');
    document.body.dataset.typing = '1';
    this.talkInput.focus();
  }
  closeTalk(): void {
    this.talkTarget = null;
    this.talk.classList.remove('on');
    delete document.body.dataset.typing;
    this.talkInput.blur();
  }

  // ── quest board ──
  get questsOpen(): boolean { return this.questPanel.classList.contains('on'); }
  setQuests(quests: Quest[]): void {
    this.quests = quests;
    if (this.questsOpen) this.renderQuests();
  }
  openQuests(): void {
    this.questPanel.classList.add('on');
    document.body.dataset.typing = '1';
    this.renderQuests();
  }
  closeQuests(): void {
    this.questPanel.classList.remove('on');
    if (!this.talkTarget) delete document.body.dataset.typing;
  }
  private renderQuests(): void {
    const list = this.questPanel.querySelector('.q-list')!;
    list.replaceChildren();
    if (!this.quests.length) {
      list.innerHTML = `<div class="q-empty">No notices pinned yet… check back soon! 🌸</div>`;
      return;
    }
    for (const q of this.quests) {
      const el = document.createElement('div');
      el.className = `q-item ${q.state}`;
      el.innerHTML = `
        <div class="q-title">${esc(q.title)} <span class="q-state">${q.state === 'offered' ? 'new!' : q.state}</span></div>
        <div class="q-pitch">${esc(q.pitch)}</div>
        <div class="q-steps">${q.steps.map((s) => `<div>${s.done ? '✅' : '⬜'} ${esc(s.text)}</div>`).join('')}</div>
        <div class="q-foot">
          <span>🪙 ${q.reward.coins}${q.source.type === 'headline' ? ' · from today’s news' : ''}</span>
          ${q.state === 'offered' ? '<button class="q-accept">Accept ✨</button>' : ''}
        </div>`;
      el.querySelector('.q-accept')?.addEventListener('click', () => this.onAccept(q.id));
      list.append(el);
    }
  }
}

