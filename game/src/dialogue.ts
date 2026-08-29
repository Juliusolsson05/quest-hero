import type { NpcDef } from './npc';
import { say, HarnessUnavailable } from './harness';

/** Dialogue overlay: the player's whole interface to an NPC agent. */
export class Dialogue {
  private readonly root: HTMLDivElement;
  private readonly transcript: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly title: HTMLDivElement;
  private npc: NpcDef | null = null;
  private busy = false;

  constructor(private readonly onClose: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'dialogue';
    this.root.innerHTML = `
      <div class="d-title"></div>
      <div class="d-transcript"></div>
      <input class="d-input" placeholder="Say something…  (Esc to leave)" autocomplete="off" />`;
    document.body.append(this.root);

    this.title = this.root.querySelector('.d-title')!;
    this.transcript = this.root.querySelector('.d-transcript')!;
    this.input = this.root.querySelector('.d-input')!;

    const style = document.createElement('style');
    style.textContent = `
      #dialogue { position: fixed; left: 50%; bottom: 6vh; transform: translateX(-50%);
        width: min(680px, 92vw); background: rgba(12,15,22,.94); border: 1px solid #2b3245;
        border-radius: 10px; padding: 14px 16px; display: none; z-index: 20; }
      #dialogue.on { display: block; }
      .d-title { font-weight: 600; letter-spacing: .01em; margin-bottom: 8px; color: #d8b98a; }
      .d-transcript { max-height: 34vh; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
      .d-line { white-space: pre-wrap; }
      .d-line.you { color: #8b94a8; }
      .d-line.err { color: #d97b7b; font-size: 13px; }
      .d-input { width: 100%; margin-top: 10px; padding: 9px 11px; border-radius: 6px;
        border: 1px solid #2b3245; background: #0b0e14; color: inherit; font: inherit; outline: none; }
      .d-input:focus { border-color: #4a5570; }`;
    document.head.append(style);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter' && this.input.value.trim() && !this.busy) this.send(this.input.value.trim());
    });
  }

  get isOpen(): boolean { return this.npc !== null; }

  open(npc: NpcDef): void {
    this.npc = npc;
    this.title.textContent = `${npc.name} — ${npc.role}`;
    this.transcript.replaceChildren();
    this.root.classList.add('on');
    // Flag the body so the player controller stops reading WASD as movement.
    document.body.dataset.typing = '1';
    document.exitPointerLock();
    this.input.value = '';
    this.input.focus();
  }

  close(): void {
    this.npc = null;
    this.root.classList.remove('on');
    delete document.body.dataset.typing;
    this.onClose();
  }

  private line(cls: string, text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `d-line ${cls}`;
    el.textContent = text;
    this.transcript.append(el);
    this.transcript.scrollTop = this.transcript.scrollHeight;
    return el;
  }

  private async send(text: string): Promise<void> {
    const npc = this.npc;
    if (!npc) return;
    this.busy = true;
    this.input.value = '';
    this.line('you', `You: ${text}`);
    const reply = this.line('npc', `${npc.name}: `);

    try {
      await say(npc, text, (delta) => {
        reply.textContent += delta;
        this.transcript.scrollTop = this.transcript.scrollHeight;
      });
    } catch (err) {
      reply.remove();
      // A missing harness is the normal state before a model is configured,
      // so it explains itself rather than failing silently.
      this.line('err', err instanceof HarnessUnavailable
        ? `[${npc.name} is silent — TrueForge unreachable at localhost:8790, or no model configured yet]`
        : `[error: ${String(err)}]`);
    } finally {
      this.busy = false;
      this.input.focus();
    }
  }
}
