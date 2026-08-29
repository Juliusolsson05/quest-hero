import type { ClientFrame, ServerFrame } from '../../shared/protocol';

/**
 * WebSocket link to the World Hub. The client renders only what the hub says
 * exists — there is no world without it, so the link keeps retrying and the
 * caller shows a "waking the village" overlay until `welcome` arrives.
 */

/**
 * Which hub to talk to. `?hub=wss://…` retargets without a rebuild and is
 * remembered, so a link handed to a friend keeps its hub as they walk around
 * and the address bar loses the query. `?hub=` (empty) forgets it again.
 * Otherwise: the build-time default (VITE_HUB_WS — how the hosted build finds
 * a tunnelled hub), then localhost for `npm run dev`.
 */
const HUB_KEY = 'sfq:hub';
const HUB_WS = (() => {
  const q = new URLSearchParams(location.search).get('hub');
  if (q !== null) {
    try { q ? localStorage.setItem(HUB_KEY, q) : localStorage.removeItem(HUB_KEY); } catch { /* private mode */ }
    if (q) return q;
  }
  try {
    const saved = localStorage.getItem(HUB_KEY);
    if (saved) return saved;
  } catch { /* private mode */ }
  return import.meta.env.VITE_HUB_WS ?? 'ws://localhost:7777/ws';
})();

type Handler = (f: ServerFrame) => void;

const RETRY_MIN = 1500;
const RETRY_MAX = 30_000;

export class Net {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<Handler>();
  private sendQueue: ClientFrame[] = [];
  private retryDelay = RETRY_MIN;
  connected = false;

  constructor(private readonly playerName: string) {
    this.dial();
  }

  private dial(): void {
    const ws = new WebSocket(HUB_WS);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      this.retryDelay = RETRY_MIN; // hub is back — snap to fast retries again
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
      // First retries stay snappy (1.5s) so the client rides through the hub
      // restarts of a hackathon, then back off to 30s — on the hosted build
      // there is no hub to find, and retrying forever at 1.5s only spams the
      // console and drains a phone battery.
      setTimeout(() => this.dial(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 1.7, RETRY_MAX);
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
