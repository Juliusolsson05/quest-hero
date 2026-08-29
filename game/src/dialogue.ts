import type { NpcDef } from './npc';
import { say, HarnessUnavailable, type TurnEvent } from './harness';

/** Dialogue overlay: the player's whole interface to an NPC agent. */
export class Dialogue {
  private readonly root: HTMLDivElement;
  private readonly transcript: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly title: HTMLDivElement;
  private npc: NpcDef | null = null;
  private busy = false;
  /** Live tool rows, keyed by tool_call_id, so a call started and later
   *  finished updates one row instead of printing twice. */
  private readonly toolRows = new Map<string, HTMLDivElement>();

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
      .d-line.conn { font-size: 12px; color: #5f6b80; font-style: italic; }
      .d-line.err { color: #d97b7b; font-size: 13px; }

      /* Tool activity. Deliberately distinct from speech: the player should
         never mistake the agent's machinery for something a character said. */
      .d-tool { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px;
        color: #7d879b; padding: 3px 8px; border-left: 2px solid #2b3245;
        background: rgba(255,255,255,.02); border-radius: 0 4px 4px 0; }
      .d-tool .mark { color: #c9a227; width: 11px; flex: none; }
      .d-tool.done .mark { color: #6a9b6a; }
      .d-tool.sys { opacity: .65; }
      .d-tool .nm { color: #9aa6bd; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .d-tool .dt { opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .d-tool.run .mark { animation: pulse 1s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .25; } }
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

  /** Renders one tool call, creating its row on first sight and completing
   *  that same row when the response arrives. */
  private renderTool(e: Extract<TurnEvent, { kind: 'tool' }>): void {
    let row = this.toolRows.get(e.id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'd-line d-tool';
      row.innerHTML = '<span class="mark"></span><span class="nm"></span><span class="dt"></span>';
      this.toolRows.set(e.id, row);
      this.transcript.append(row);
    }
    row.classList.toggle('sys', e.system);
    row.classList.toggle('done', e.done);
    row.classList.toggle('run', !e.done);
    row.querySelector('.mark')!.textContent = e.done ? '✓' : '▸';
    row.querySelector('.nm')!.textContent = e.name;
    row.querySelector('.dt')!.textContent = e.detail ? `— ${e.detail}` : '';
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  private async send(text: string): Promise<void> {
    const npc = this.npc;
    if (!npc) return;
    this.busy = true;
    this.toolRows.clear();
    this.input.value = '';
    this.line('you', `You: ${text}`);
    const reply = document.createElement('div');
    reply.className = 'd-line npc';
    reply.textContent = `${npc.name}: `;

    try {
      await say(npc, text, (e) => {
        if (e.kind === 'text') {
          // Keep the spoken reply below the machinery that produced it, so the
          // transcript reads in the order things actually happened.
          this.transcript.append(reply);
          reply.textContent += e.text;
        } else if (e.kind === 'connect') {
          this.line('conn', `connected: ${e.servers.join(', ')}`);
        } else {
          this.renderTool(e);
        }
        this.transcript.scrollTop = this.transcript.scrollHeight;
      });
    } catch (err) {
      reply.remove();
      // A missing harness is the normal state before a model is configured,
      // so it explains itself rather than failing silently.
      // HarnessUnavailable carries a specific cause (harness down, no model
      // configured, bad response); showing it beats a generic guess.
      this.line('err', err instanceof HarnessUnavailable
        ? `[${npc.name} is silent — ${err.message}]`
        : `[error: ${String(err)}]`);
    } finally {
      this.busy = false;
      this.input.focus();
    }
  }
}
