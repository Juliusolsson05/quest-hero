import { SODA_BASE, SOURCES, type SfSource } from './sources.js';

/**
 * Data access for the SF guide.
 *
 * Kept separate from the MCP wiring so the tools stay thin: every tool is a
 * schema plus a call into here. Responses are trimmed hard before they reach
 * the agent — a raw Socrata page can be hundreds of KB of repeated fields,
 * and an NPC that floods its own context with tree records stops being able
 * to hold a conversation.
 */

const UA = 'quest-hero-sf-guide (hackathon)';

async function getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function findSource(id: string): SfSource | undefined {
  return SOURCES.find((s) => s.id === id);
}

/**
 * Queries a DataSF dataset through the Socrata SODA API.
 *
 * `where` is passed through as SoQL. That is deliberate: the agent composing
 * its own filter is the whole point — it can ask for trees of one species on
 * one street without us having predicted that question. It is also why the
 * row cap is enforced here rather than trusted to the caller.
 */
export async function queryDataset(opts: {
  sourceId: string;
  where?: string;
  select?: string;
  order?: string;
  limit?: number;
}): Promise<{ source: string; rows: unknown[]; note?: string }> {
  const src = findSource(opts.sourceId);
  if (!src || src.kind !== 'datasf' || !src.resource) {
    throw new Error(
      `unknown dataset "${opts.sourceId}". Call sf_list_sources for valid ids.`,
    );
  }

  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const params = new URLSearchParams({ $limit: String(limit) });
  if (opts.where) params.set('$where', opts.where);
  if (opts.select) params.set('$select', opts.select);
  if (opts.order) params.set('$order', opts.order);

  const url = `${SODA_BASE}/${src.resource}.json?${params}`;
  const rows = (await getJson(url)) as Record<string, unknown>[];

  return {
    source: src.title,
    rows: rows.map(trimRow),
    note: rows.length === limit ? `capped at ${limit} rows` : undefined,
  };
}

/** Socrata rows carry geometry blobs and duplicated lat/long fields that cost
 *  context and tell the agent nothing it can use in dialogue. */
function trimRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith(':@')) continue;
    if (k === 'the_geom' || k === 'shape' || k === 'point' || k === 'location') continue;
    if (v && typeof v === 'object') continue;
    if (typeof v === 'string' && v.length > 300) continue;
    out[k] = v;
  }
  return out;
}

/** Column names for a dataset, so the agent can write a sensible $where
 *  instead of guessing field names and getting a 400 back. */
export async function describeDataset(sourceId: string): Promise<{ source: string; columns: string[] }> {
  const src = findSource(sourceId);
  if (!src || src.kind !== 'datasf' || !src.resource) throw new Error(`unknown dataset "${sourceId}"`);
  const rows = (await getJson(`${SODA_BASE}/${src.resource}.json?$limit=1`)) as Record<string, unknown>[];
  return { source: src.title, columns: rows[0] ? Object.keys(rows[0]).filter((c) => !c.startsWith(':@')) : [] };
}

async function restFor(id: string): Promise<unknown> {
  const src = findSource(id);
  if (!src?.url) throw new Error(`no endpoint for "${id}"`);
  return getJson(src.url);
}

/** Weather, air quality and the NWS narrative in one call. Visibility is the
 *  field that answers "is it foggy", which is the question actually asked. */
export async function liveConditions(): Promise<Record<string, unknown>> {
  const [weather, air] = await Promise.allSettled([restFor('weather'), restFor('air_quality')]);

  const out: Record<string, unknown> = {};
  if (weather.status === 'fulfilled') {
    const c = (weather.value as { current?: Record<string, unknown> }).current ?? {};
    out.temperature_c = c.temperature_2m;
    out.feels_like_c = c.apparent_temperature;
    out.wind_kmh = c.wind_speed_10m;
    out.cloud_cover_pct = c.cloud_cover;
    out.visibility_m = c.visibility;
    // The guide should not have to reason about metres to answer "is it foggy".
    if (typeof c.visibility === 'number') {
      out.fog = c.visibility < 1000 ? 'thick fog' : c.visibility < 5000 ? 'hazy / light fog' : 'clear';
    }
  }
  if (air.status === 'fulfilled') {
    const c = (air.value as { current?: Record<string, unknown> }).current ?? {};
    out.us_aqi = c.us_aqi;
    out.pm2_5 = c.pm2_5;
  }
  return out;
}

export async function earthquakes(): Promise<unknown[]> {
  const data = (await restFor('earthquakes')) as { features?: { properties: Record<string, unknown> }[] };
  return (data.features ?? []).map((f) => ({
    magnitude: f.properties.mag,
    place: f.properties.place,
    when: new Date(f.properties.time as number).toISOString(),
  }));
}

export async function tidesAndSun(): Promise<Record<string, unknown>> {
  const [tides, sun] = await Promise.allSettled([restFor('tides'), restFor('sun')]);
  const out: Record<string, unknown> = {};
  if (tides.status === 'fulfilled') {
    const p = (tides.value as { predictions?: { t: string; v: string; type: string }[] }).predictions ?? [];
    out.tides_today = p.map((x) => ({ time: x.t, feet: x.v, kind: x.type === 'H' ? 'high' : 'low' }));
  }
  if (sun.status === 'fulfilled') {
    const r = (sun.value as { results?: Record<string, string> }).results ?? {};
    out.sunrise = r.sunrise;
    out.sunset = r.sunset;
    out.golden_hour = r.sunset; // close enough for "when to photograph the bridge"
  }
  return out;
}

/** Live dock and bike counts. GBFS is a manifest of feeds, so this follows the
 *  station_status link rather than assuming a fixed URL. */
export async function bikeShare(): Promise<Record<string, unknown>> {
  const manifest = (await restFor('bay_wheels')) as {
    data?: { en?: { feeds?: { name: string; url: string }[] } };
    feeds?: { name: string; url: string }[];
  };
  const feeds = manifest.data?.en?.feeds ?? manifest.feeds ?? [];
  const status = feeds.find((f) => f.name === 'station_status');
  if (!status) throw new Error('no station_status feed in GBFS manifest');

  const s = (await getJson(status.url)) as { data?: { stations?: Record<string, unknown>[] } };
  const stations = s.data?.stations ?? [];
  const bikes = stations.reduce((n, st) => n + Number(st.num_bikes_available ?? 0), 0);
  const docks = stations.reduce((n, st) => n + Number(st.num_docks_available ?? 0), 0);
  return { stations: stations.length, bikes_available: bikes, docks_available: docks };
}

/** Anything with a Wikipedia article near a point — an instant walking tour. */
export async function nearbyLandmarks(lat: number, lon: number, radiusM = 1500): Promise<unknown[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch` +
    `&gscoord=${lat}%7C${lon}&gsradius=${Math.min(radiusM, 10000)}&gslimit=15&format=json`;
  const data = (await getJson(url)) as { query?: { geosearch?: { title: string; dist: number }[] } };
  return (data.query?.geosearch ?? []).map((g) => ({ title: g.title, metres_away: Math.round(g.dist) }));
}
