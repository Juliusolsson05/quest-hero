/**
 * World Hub boot: one express app + one http server + ws on /ws, then the
 * 10 Hz sim and the real-data ingestors. Port 7777, CORS open (localhost
 * hackathon mode). Contract: docs/API.md; shapes: shared/protocol.ts.
 */
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientFrame, ServerFrame } from '../../shared/protocol';
import { mountApi } from './api';
import { startChatter } from './chatter';
import { CONFIG } from './config';
import { talk } from './dialogue';
import { startIngest } from './ingest';
import { island } from '../../shared/island';
import { startSim } from './sim';
import {
  acceptQuest,
  getPlayer,
  playerHello,
  setBroadcast,
  updatePlayerPose,
  worldSnapshot,
} from './state';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));
mountApi(app);

// malformed JSON bodies (and anything else express catches) → JSON {error}
app.use((err: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  res.status(err.status ?? 500).json({ error: err.message || 'internal error' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();

setBroadcast((frame: ServerFrame) => {
  const payload = JSON.stringify(frame);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
});

wss.on('connection', (ws) => {
  clients.add(ws);
  // Welcome immediately — a client can render the island before saying hello.
  const welcome: ServerFrame = { t: 'welcome', world: worldSnapshot(), island, you: 'player' };
  ws.send(JSON.stringify(welcome));

  ws.on('message', (raw) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(String(raw)) as ClientFrame;
    } catch {
      return; // not JSON — not worth killing the socket over
    }
    try {
      switch (frame.t) {
        case 'hello':
          playerHello(typeof frame.name === 'string' ? frame.name : 'Traveller');
          break;
        case 'pose':
          updatePlayerPose(frame.pos, frame.rot, frame.anim);
          break;
        case 'talk':
          talk(frame.npcId, frame.text, getPlayer().name);
          break;
        case 'quest':
          if (frame.action === 'accept') acceptQuest(frame.id);
          break;
        case 'interact':
          break; // proximity interactions resolve through talk/goto tracking
      }
    } catch (e) {
      console.warn('[ws] frame handling failed:', e instanceof Error ? e.message : e);
    }
  });

  const drop = () => clients.delete(ws);
  ws.on('close', drop);
  ws.on('error', drop);
});

server.listen(CONFIG.port, () => {
  console.log(`[hub] World Hub v2 listening on http://localhost:${CONFIG.port}`);
  console.log(`[hub] WS ws://localhost:${CONFIG.port}/ws · SSE /api/events/stream · contract docs/API.md`);
  console.log(`[hub] TrueForge at ${CONFIG.trueforgeBase} · GitHub repo ${CONFIG.githubRepo}`);
  startSim();
  startIngest();
  startChatter();
});
