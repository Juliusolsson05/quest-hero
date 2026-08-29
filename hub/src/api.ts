/**
 * REST routes — the exact surface documented in docs/API.md. The MCP servers
 * wrap these endpoints 1:1, so paths and bodies here are a frozen contract.
 * Errors are always JSON {error}; unknown kinds/pois list the allowed values.
 */
import type { Express, Request, Response } from 'express';
import type { Emotion, ObjectKind, Quest, TimePhase, Vec3, WeatherKind } from '../../shared/protocol';
import { chatterStatus, forceChatter } from './chatter';
import { getConversation, talk, validateSteps } from './dialogue';
import { heightAt, island, NEAR_TARGETS, poi, POI_IDS, randomWalkableNear } from '../../shared/island';
import { overrideTime, overrideWeather, resumeAutoWeather, resumeRealTime } from './ingest';
import { sendNpcTo } from './sim';
import {
  addEvent,
  addQuest,
  advanceQuest,
  EMOTIONS,
  getNpc,
  getPlayer,
  getQuest,
  getTime,
  getWeather,
  givePlayer,
  listEvents,
  listNpcs,
  listQuests,
  npcAmbientSay,
  OBJECT_KINDS,
  onEvent,
  removeObject,
  spawnObject,
  TIME_PHASES,
  WEATHER_KINDS,
  worldSnapshot,
} from './state';
import { clamp, nextId } from './util';

const started = Date.now();

const bad = (res: Response, error: string): Response => res.status(400).json({ error });
const missing = (res: Response, error: string): Response => res.status(404).json({ error });

export function mountApi(app: Express): void {
  // ── read ──────────────────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptimeS: Math.round((Date.now() - started) / 1000), version: 'v2' });
  });

  app.get('/api/world', (_req, res) => {
    // The everything call. `island` rides along so one fetch paints a client.
    res.json({ ...worldSnapshot(), island });
  });

  app.get('/api/npcs', (_req, res) => res.json(listNpcs()));

  app.get('/api/npcs/:id', (req, res) => {
    const npc = getNpc(req.params.id);
    if (!npc) return missing(res, `unknown npc "${req.params.id}" — allowed: ${listNpcs().map((n) => n.id).join(', ')}`);
    res.json(npc);
  });

  app.get('/api/events', (req, res) => {
    const since = Number(req.query.since ?? 0);
    const limit = Number(req.query.limit ?? 50);
    const types = typeof req.query.types === 'string' && req.query.types ? req.query.types.split(',') : undefined;
    if (Number.isNaN(since) || Number.isNaN(limit)) return bad(res, 'since and limit must be numbers');
    res.json(listEvents({ since, limit, ...(types ? { types } : {}) }));
  });

  app.get('/api/events/stream', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': quest-hero world hub event stream\n\n');
    for (const e of listEvents({ since: 0, limit: 200 }).slice(-20)) {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    }
    const unsubscribe = onEvent((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get('/api/quests', (_req, res) => res.json(listQuests()));
  app.get('/api/weather', (_req, res) => res.json(getWeather()));
  app.get('/api/time', (_req, res) => res.json(getTime()));

  app.get('/api/player', (_req, res) => {
    const activeQuest = listQuests().find((q) => q.state === 'active') ?? null;
    res.json({ ...getPlayer(), activeQuest });
  });

  app.get('/api/island', (_req, res) => res.json(island));

  app.get('/api/conversations/:id', (req, res) => {
    const conv = getConversation(req.params.id);
    if (!conv) return missing(res, `unknown conversation "${req.params.id}"`);
    res.json(conv);
  });

  app.get('/api/chatter', (_req, res) => res.json(chatterStatus()));

  // ── write ─────────────────────────────────────────────────────────────────

  app.post('/api/chatter', (req, res) => {
    const { a, b } = (req.body ?? {}) as { a?: string; b?: string };
    if ((a && !getNpc(a)) || (b && !getNpc(b))) {
      return missing(res, `unknown npc — allowed: ${listNpcs().map((n) => n.id).join(', ')}`);
    }
    const started = forceChatter(a, b);
    if (!started) return bad(res, 'a conversation is already running (GET /api/chatter)');
    res.json({ started, note: 'news + script are generating; bubbles begin in ~5-20s' });
  });

  app.post('/api/npcs/:id/say', (req, res) => {
    const npc = getNpc(req.params.id);
    if (!npc) return missing(res, `unknown npc "${req.params.id}" — allowed: ${listNpcs().map((n) => n.id).join(', ')}`);
    const { text, emotion } = (req.body ?? {}) as { text?: unknown; emotion?: unknown };
    if (typeof text !== 'string' || !text.trim()) return bad(res, 'text (non-empty string) is required');
    if (emotion !== undefined && !EMOTIONS.includes(emotion as Emotion)) {
      return bad(res, `unknown emotion "${emotion}" — allowed: ${EMOTIONS.join(', ')}`);
    }
    npcAmbientSay(npc.id, text.trim().slice(0, 240), (emotion as Emotion) ?? 'neutral');
    res.json(npc);
  });

  app.post('/api/npcs/:id/goto', (req, res) => {
    const npc = getNpc(req.params.id);
    if (!npc) return missing(res, `unknown npc "${req.params.id}" — allowed: ${listNpcs().map((n) => n.id).join(', ')}`);
    const { poi: poiId } = (req.body ?? {}) as { poi?: unknown };
    if (typeof poiId !== 'string' || !poi(poiId)) {
      return bad(res, `unknown poi "${poiId}" — allowed: ${POI_IDS.join(', ')}`);
    }
    res.json(sendNpcTo(npc.id, poiId));
  });

  app.post('/api/npcs/:id/talk', (req, res) => {
    const npc = getNpc(req.params.id);
    if (!npc) return missing(res, `unknown npc "${req.params.id}" — allowed: ${listNpcs().map((n) => n.id).join(', ')}`);
    const { text, from } = (req.body ?? {}) as { text?: unknown; from?: unknown };
    if (typeof text !== 'string' || !text.trim()) return bad(res, 'text (non-empty string) is required');
    const conversationId = talk(npc.id, text, typeof from === 'string' && from.trim() ? from.trim() : undefined);
    if (!conversationId) return bad(res, 'could not start conversation');
    res.json({ conversationId });
  });

  app.post('/api/objects', (req, res) => {
    const { kind, pos, near, ttlS } = (req.body ?? {}) as {
      kind?: unknown;
      pos?: Partial<Vec3>;
      near?: unknown;
      ttlS?: unknown;
    };
    if (typeof kind !== 'string' || !OBJECT_KINDS.includes(kind as ObjectKind)) {
      return bad(res, `unknown kind "${kind}" — allowed: ${OBJECT_KINDS.join(', ')}`);
    }
    let at: Vec3;
    if (pos && typeof pos.x === 'number' && typeof pos.z === 'number') {
      at = { x: pos.x, y: typeof pos.y === 'number' ? pos.y : heightAt(pos.x, pos.z), z: pos.z };
    } else {
      const anchor = typeof near === 'string' ? near : 'plaza';
      if (!(NEAR_TARGETS as readonly string[]).includes(anchor)) {
        return bad(res, `unknown near "${anchor}" — allowed: ${NEAR_TARGETS.join(', ')}`);
      }
      const p = poi(anchor)!.pos;
      at = randomWalkableNear(p.x, p.z, 2.5);
    }
    if (ttlS !== undefined && (typeof ttlS !== 'number' || ttlS <= 0)) {
      return bad(res, 'ttlS must be a positive number of seconds');
    }
    const whereWord = typeof near === 'string' ? `near the ${near}` : 'in the village';
    const obj = spawnObject(kind as ObjectKind, at, 'mcp', ttlS as number | undefined, `A ${kind} appeared ${whereWord}`);
    res.json(obj);
  });

  app.delete('/api/objects/:id', (req, res) => {
    const removed = removeObject(req.params.id, undefined);
    if (!removed) return missing(res, `unknown object "${req.params.id}"`);
    res.json(removed);
  });

  app.post('/api/weather', (req, res) => {
    const { kind, minutes } = (req.body ?? {}) as { kind?: unknown; minutes?: unknown };
    if (kind === 'auto') {
      resumeAutoWeather();
      return res.json(getWeather());
    }
    if (typeof kind !== 'string' || !WEATHER_KINDS.includes(kind as WeatherKind)) {
      return bad(res, `unknown kind "${kind}" — allowed: ${WEATHER_KINDS.join(', ')}, auto`);
    }
    if (minutes !== undefined && (typeof minutes !== 'number' || minutes <= 0)) {
      return bad(res, 'minutes must be a positive number');
    }
    overrideWeather(kind as WeatherKind, minutes as number | undefined);
    res.json(getWeather());
  });

  app.post('/api/time', (req, res) => {
    const { phase, hour, mode } = (req.body ?? {}) as { phase?: unknown; hour?: unknown; mode?: unknown };
    if (mode === 'real') return res.json(resumeRealTime());
    if (phase !== undefined) {
      if (!TIME_PHASES.includes(phase as TimePhase)) {
        return bad(res, `unknown phase "${phase}" — allowed: ${TIME_PHASES.join(', ')}`);
      }
      return res.json(overrideTime({ phase: phase as TimePhase }));
    }
    if (hour !== undefined) {
      if (typeof hour !== 'number' || hour < 0 || hour > 24) return bad(res, 'hour must be a number 0-24');
      return res.json(overrideTime({ hour }));
    }
    return bad(res, "provide {phase}, {hour}, or {mode:'real'}");
  });

  app.post('/api/quests', (req, res) => {
    const { title, pitch, giver, steps, reward } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof title !== 'string' || !title.trim()) return bad(res, 'title (non-empty string) is required');
    if (typeof pitch !== 'string' || !pitch.trim()) return bad(res, 'pitch (non-empty string) is required');
    const giverId = giver === undefined ? 'wren' : giver;
    if (typeof giverId !== 'string' || !getNpc(giverId)) {
      return bad(res, `unknown giver "${giverId}" — allowed: ${listNpcs().map((n) => n.id).join(', ')}`);
    }
    let questSteps = validateSteps(steps ?? [{ kind: 'goto', target: 'board', text: 'Read the notice board' }]);
    if (!questSteps) {
      return bad(
        res,
        'invalid steps — each needs kind talk|goto|collect, a valid target ' +
          `(talk: ${listNpcs().map((n) => n.id).join('/')}; goto: ${POI_IDS.join('/')}; collect: item id) and text`,
      );
    }
    const coins = clamp(Math.round(Number((reward as { coins?: unknown } | undefined)?.coins ?? 5)) || 5, 1, 100);
    const item = (reward as { item?: unknown } | undefined)?.item;
    const quest: Quest = {
      id: nextId('quest'),
      title: title.trim().slice(0, 80),
      pitch: pitch.trim().slice(0, 200),
      giver: giverId,
      source: { type: 'mcp' },
      steps: questSteps,
      state: 'offered',
      reward: { coins, ...(typeof item === 'string' && item ? { item } : {}) },
    };
    res.json(addQuest(quest));
  });

  app.post('/api/quests/:id/advance', (req, res) => {
    const quest = getQuest(req.params.id);
    if (!quest) return missing(res, `unknown quest "${req.params.id}"`);
    const { stepId } = (req.body ?? {}) as { stepId?: unknown };
    const result = advanceQuest(quest.id, typeof stepId === 'string' ? stepId : undefined);
    if (result.error) return bad(res, result.error);
    res.json(result.quest);
  });

  app.post('/api/events', (req, res) => {
    const { summary, data } = (req.body ?? {}) as { summary?: unknown; data?: unknown };
    if (typeof summary !== 'string' || !summary.trim()) return bad(res, 'summary (non-empty string) is required');
    const event = addEvent(
      'mcp.custom',
      summary.trim().slice(0, 240),
      'mcp',
      data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined,
    );
    res.json(event);
  });

  app.post('/api/player/give', (req, res) => {
    const { item, n } = (req.body ?? {}) as { item?: unknown; n?: unknown };
    if (typeof item !== 'string' || !item.trim()) return bad(res, 'item (non-empty string) is required');
    if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 1)) {
      return bad(res, 'n must be a positive number');
    }
    res.json(givePlayer(item.trim(), Math.round((n as number | undefined) ?? 1)));
  });

  // ── errors ────────────────────────────────────────────────────────────────

  app.use('/api', (_req: Request, res: Response) => missing(res, 'not found'));
}
