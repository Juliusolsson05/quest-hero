import type { ClientFrame, ServerFrame } from '../../shared/protocol';

/**
 * WebSocket link to the World Hub. The client renders only what the hub says
 * exists — there is no world without it, so the link keeps retrying and the
 * caller shows a "waking the village" overlay until `welcome` arrives.
 */

const HUB_WS = import.meta.env.VITE_HUB_WS ?? 'ws://localhost:7777/ws';

type Handler = (f: ServerFrame) => void;

export class Net {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<Handler>();
  private sendQueue: ClientFrame[] = [];
  connected = false;

  constructor(private readonly playerName: string) {
    this.dial();
  }

  private dial(): void {
    const ws = new WebSocket(HUB_WS);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      ws.send(JSON.stringify({ t: 'hello', name: this.playerName } satisfies ClientFrame));
      for (const f of this.sendQueue.splice(0)) ws.send(JSON.stringify(f));
    });

    ws.addEventListener('message', (e) => {
      let frame: ServerFrame;
      try { frame = JSON.parse(e.data as string); } catch { return; }
      for (const h of this.handlers) h(frame);
    });

    ws.addEventListener('close', () => {
      this.connected = false;
      // Steady 1.5s retry: at a hackathon the hub restarts constantly and the
      // client should just ride through it.
      setTimeout(() => this.dial(), 1500);
    });
    ws.addEventListener('error', () => ws.close());
  }

  on(handler: Handler): void {
    this.handlers.add(handler);
  }

  send(frame: ClientFrame): void {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    } else if (frame.t !== 'pose') {
      // Poses are ephemeral; everything else is worth delivering on reconnect.
      this.sendQueue.push(frame);
    }
  }
}
