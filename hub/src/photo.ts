/**
 * The Lens — photo mode's field archivist, and the agent behind it.
 *
 * A photograph arrives as a subject (a real San Francisco building, resolved
 * client-side in game/src/photo/landmarks.ts) and leaves as a dossier: a
 * caption and three or four facts, each fetched live and each carrying the
 * dataset it came from. Nothing here is written in advance — the agent is
 * handed the `sf-guide` MCP server (32 live SF sources: DataSF, NOAA, USGS,
 * Open-Meteo, Wikipedia) and told to go and look.
 *
 * It sits on ./trueforge like everything else that talks to the harness. The
 * Lens is a named entry in the Agent Library (`ashford-lens`), so it is
 * visible, editable and runnable in the TrueForge UI beside the villagers, and
 * one session per subject id means photographing the same building twice
 * reaches the archivist who already saw your first shot.
 *
 * Streamed to the browser as SSE, because a dossier that fills in line by line
 * with its tool calls showing is the point: the player watches the agent work.
 */
import type { Express, Request, Response } from 'express';
import type { LensShot, LensSubject, LensWorld } from '../../shared/lens';
import { addEvent, getTime, getWeather } from './state';
import { sessionFor, streamTurn, userMessage, type AgentDef } from './trueforge';
import { warnOnce } from './util';

/** Silence this long with no bytes at all → the stream is dead. Wide, because
 *  a DataSF query is silent on the wire until its tool.response lands. */
const STALL_MS = 45_000;
/** Hard ceiling per photograph. A dossier that takes two minutes has lost the
 *  player, who is standing in the street holding a camera. */
const SHOT_CAP_MS = 90_000;

/**
 * The archivist, as the Agent Library knows it.
 *
 * Subagents stay on (the default): a shot needing the landmark register *and*
 * today's tides is exactly the fan-out the harness is good at, and each thread
 * surfaces in the card as its own badge. Reasoning effort and parallel tool
 * calls used to be set here; buildManifest owns the spec now, and losing that
 * knob is the price of having one place that talks to the harness.
 */
export const LENS_DEF: AgentDef = {
  registryName: 'ashford-lens',
  model: 'openai/gpt-5-5',
  connectors: ['sf-guide'],
  // Web search is the backstop for a building the city's own datasets have
  // never heard of; the persona keeps it firmly in second place.
  webAccess: true,
  persona:
    "You are the Lens: the field archivist who develops the traveller's photographs in SF Quest, " +
    'a voxel San Francisco. The traveller points a camera at a building and you tell them what it ' +
    'actually is, using live data.\n\n' +
    'You have the sf-guide MCP server: 32 live San Francisco sources — DataSF datasets (historic ' +
    'landmarks, film locations, registered businesses, street trees, 311 cases, evictions, public ' +
    'art, parks, Muni stops, health inspections), plus live weather and air quality, NOAA tides ' +
    'under the Golden Gate, USGS earthquakes, Bay Wheels docks, and Wikipedia geosearch. ' +
    'Call sf_list_sources if you are unsure what exists, and sf_describe_dataset before writing a ' +
    'SoQL filter so you use real column names.\n\n' +
    'RULES\n' +
    '1. Make at least two tool calls before you answer. Every fact you state must come from a tool ' +
    'result in THIS turn.\n' +
    '2. Never invent a number, a date, an address, a business name or a count. If a query comes ' +
    'back empty, say the record is not there — that is a real finding, and the player would rather ' +
    'have it than a plausible sentence.\n' +
    '3. Prefer the sf-guide sources. If you also have web search, use it only to confirm a ' +
    "building's identity when the city datasets have nothing, and label it as web.\n\n" +
    'FORMAT — exactly this, no markdown, no preamble:\n' +
    'CAPTION: one line, at most 90 characters, what this photograph shows, in the warm voice of ' +
    'someone who loves this city.\n' +
    'Then 3 or 4 lines, each starting with "- ", each one concrete fact from a tool result, at most ' +
    '160 characters, ending with " — source: <dataset or feed you called>".\n' +
    'Favour what is true TODAY (conditions, tides, live counts, recent 311 or business filings) ' +
    'over encyclopedia facts, and favour the surprising over the obvious.\n\n' +
    'Work briskly: three to six tool calls is the right size of hunt. The player is standing in ' +
    'the street holding a camera, and four good facts now beat six perfect ones a minute from now.',
};

/** The turn itself: one photograph, described. */
function lensBrief(subject: LensSubject, shot: LensShot, world: LensWorld): string {
  const clock = `${String(Math.floor(world.hour) % 24).padStart(2, '0')}:` +
    `${String(Math.floor((world.hour % 1) * 60)).padStart(2, '0')}`;
  return [
    'PHOTOGRAPH JUST TAKEN',
    `subject: ${subject.name}`,
    subject.where ? `address: ${subject.where}` : '',
    subject.district ? `district: ${subject.district}` : '',
    `coordinates: ${subject.lat.toFixed(4)}, ${subject.lon.toFixed(4)}`,
    `framing: ${Math.round(shot.distanceM)}m away, facing ${shot.bearing}, ${Math.round(shot.focalMm)}mm`,
    `in the game right now: ${clock}, ${world.weather} ${Math.round(world.tempC)}\u00B0C ` +
      '(the game mirrors real San Francisco weather and time)',
    subject.sources.length ? `sources worth trying first: ${subject.sources.join(', ')}` : '',
    '',
    'Look this building up and write its dossier in the required format.',
  ].filter(Boolean).join('\n');
}

interface Shot extends LensSubject, LensShot {}

/** The browser is a client like any other: cap every string, coerce every
 *  number, and never let a field through at a length that would crowd the
 *  agent's context. */

function parseShot(body: unknown): Shot | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = (b.subject ?? {}) as Record<string, unknown>;
  const f = (b.shot ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const name = str(s.name, 90);
  if (!name) return null;
  return {
    id: str(s.id, 60) || 'unknown',
    name,
    where: str(s.where, 90),
    district: str(s.district, 60),
    lat: num(s.lat, -90, 90, 37.7749),
    lon: num(s.lon, -180, 180, -122.4194),
    sources: Array.isArray(s.sources) ? s.sources.slice(0, 6).map((x) => str(x, 40)).filter(Boolean) : [],
    distanceM: Math.round(num(f.distanceM, 0, 999, 30)),
    bearing: str(f.bearing, 20) || 'ahead',
    focalMm: Math.round(num(f.focalMm, 8, 400, 35)),
  };
}

function shotBrief(shot: Shot): string {
  const t = getTime();
  const w = getWeather();
  return lensBrief(shot, shot, { hour: t.hour, weather: w.kind, tempC: w.tempC });
}

export function mountPhoto(app: Express): void {
  /**
   * POST /api/photo → text/event-stream
   *   {"t":"tool","label":"sf_query_dataset: landmarks"}
   *   {"t":"delta","text":"CAPTION: …"}
   *   {"t":"done"} | {"t":"error","message":"…"}
   */
  app.post('/api/photo', async (req: Request, res: Response) => {
    const shot = parseShot(req.body);
    if (!shot) {
      res.status(400).json({ error: 'body must be {subject:{name,…}, shot:{…}}' });
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // a proxy that buffers this turns it back into a lump
    });
    const send = (o: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(o)}\n\n`);
    };

    addEvent('mcp.custom', `📸 the traveller photographed ${shot.name}`, 'player', {
      subject: shot.id,
      lat: shot.lat,
      lon: shot.lon,
    });

    const ctrl = new AbortController();
    let watchdog = setTimeout(() => ctrl.abort(), STALL_MS);
    const cap = setTimeout(() => ctrl.abort(), SHOT_CAP_MS);
    // `res`, not `req`: express.json() has already drained the request body,
    // so the request stream closes the instant we start streaming.
    res.on('close', () => ctrl.abort());

    let wrote = 0;
    try {
      const sid = await sessionFor(`photo:${shot.id}`, LENS_DEF, ctrl.signal);
      await streamTurn(
        sid,
        userMessage(shotBrief(shot)),
        {
          onActivity: () => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => ctrl.abort(), STALL_MS);
          },
          onDelta: (text) => {
            wrote += text.length;
            send({ t: 'delta', text });
          },
          onTool: (label) => send({ t: 'tool', label }),
          // A fan-out is work the player is waiting on; badge it like a tool.
          onThread: (title) => send({ t: 'tool', label: `subagent: ${title}` }),
        },
        ctrl.signal,
      );
      send({ t: 'done' });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // A dossier cut off halfway is still a dossier — the client keeps what
      // arrived, and only a shot with nothing at all reads as a failure.
      if (!wrote) {
        warnOnce('photo-down', `[photo] TrueForge unreachable (${why}) — dossiers unavailable`);
        send({ t: 'error', message: why.slice(0, 160) });
      } else {
        send({ t: 'done' });
      }
    } finally {
      clearTimeout(watchdog);
      clearTimeout(cap);
      res.end();
    }
  });
}
