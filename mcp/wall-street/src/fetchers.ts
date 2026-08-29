import {
  FUNDAMENTAL_TAGS,
  FX_BASE,
  INTERESTING_FORMS,
  MARKET_INDICES,
  SEC_DATA_BASE,
  SEC_TICKERS_URL,
  SEC_UA,
  YAHOO_HOSTS,
} from './sources.js';

/**
 * Data access for Preston.
 *
 * Kept separate from the MCP wiring so the tools stay thin: every tool is a
 * schema plus a call into here. Everything is trimmed hard before it reaches
 * the agent — a Yahoo chart response for a 5y range is thousands of numbers,
 * and an NPC that spends its context on raw OHLC arrays stops being able to
 * hold a conversation.
 */

const YAHOO_UA = 'Mozilla/5.0 (quest-hero-hackathon)';

async function getJson(url: string, headers: Record<string, string>, timeoutMs = 12_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Yahoo, with the second host as a fallback.
 *
 * Yahoo rate-limits per host and does it without warning. On a hackathon demo
 * the failure we cannot afford is the one that happens live in front of judges,
 * so a 429 on query1 silently retries query2 rather than surfacing.
 */
async function yahoo(path: string): Promise<unknown> {
  let lastErr: unknown;
  for (const host of YAHOO_HOSTS) {
    try {
      return await getJson(`${host}${path}`, { 'user-agent': YAHOO_UA });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const sec = (url: string) => getJson(url, { 'user-agent': SEC_UA, accept: 'application/json' });

function pct(n: unknown): number | undefined {
  return typeof n === 'number' ? Math.round(n * 100) / 100 : undefined;
}

// ── quotes and history ──────────────────────────────────────────────────────

interface ChartMeta {
  symbol?: string;
  currency?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketTime?: number;
  longName?: string;
  shortName?: string;
}

interface ChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
}

async function chart(symbol: string, range: string, interval: string): Promise<ChartResult> {
  const sym = encodeURIComponent(symbol.trim().toUpperCase());
  const body = (await yahoo(`/v8/finance/chart/${sym}?range=${range}&interval=${interval}`)) as {
    chart?: { result?: ChartResult[]; error?: { description?: string } };
  };
  const err = body?.chart?.error;
  if (err) throw new Error(err.description ?? `no data for "${symbol}"`);
  const result = body?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`unknown symbol "${symbol}". Try stock_search to find the ticker.`);
  return result;
}

/**
 * Live quote. The percent change is computed here rather than read from
 * `regularMarketChangePercent`, which Yahoo omits on index symbols — Preston
 * quoting a change for NVDA but not for the S&P would read as a bug.
 */
export async function quote(symbol: string): Promise<Record<string, unknown>> {
  const m = (await chart(symbol, '1d', '1d')).meta!;
  const price = m.regularMarketPrice;
  const prev = m.chartPreviousClose ?? m.previousClose;
  const changePct =
    typeof price === 'number' && typeof prev === 'number' && prev !== 0
      ? pct(((price - prev) / prev) * 100)
      : undefined;

  return {
    symbol: m.symbol,
    name: m.longName ?? m.shortName,
    exchange: m.fullExchangeName,
    currency: m.currency,
    price: pct(price),
    previous_close: pct(prev),
    change_pct: changePct,
    day_high: pct(m.regularMarketDayHigh),
    day_low: pct(m.regularMarketDayLow),
    fifty_two_week_high: pct(m.fiftyTwoWeekHigh),
    fifty_two_week_low: pct(m.fiftyTwoWeekLow),
    volume: m.regularMarketVolume,
    as_of: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : undefined,
  };
}

/** OHLC bars, capped and rounded. The cap exists because a 5y daily range is
 *  ~1250 bars: useful to a chart, ruinous to a dialogue context. */
export async function history(
  symbol: string,
  range: string,
  interval: string,
  limit = 30,
): Promise<Record<string, unknown>> {
  const r = await chart(symbol, range, interval);
  const q = r.indicators?.quote?.[0] ?? {};
  const stamps = r.timestamp ?? [];
  const n = Math.min(Math.max(limit, 1), 60);

  const bars: Record<string, unknown>[] = [];
  for (let i = Math.max(0, stamps.length - n); i < stamps.length; i++) {
    if (q.close?.[i] == null) continue; // holidays and halts leave null bars
    bars.push({
      date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
      open: pct(q.open?.[i] ?? undefined),
      high: pct(q.high?.[i] ?? undefined),
      low: pct(q.low?.[i] ?? undefined),
      close: pct(q.close[i] ?? undefined),
      volume: q.volume?.[i] ?? undefined,
    });
  }

  const first = bars[0]?.close as number | undefined;
  const last = bars[bars.length - 1]?.close as number | undefined;
  return {
    symbol: r.meta?.symbol,
    name: r.meta?.longName ?? r.meta?.shortName,
    range,
    interval,
    bars,
    change_over_range_pct:
      typeof first === 'number' && typeof last === 'number' && first !== 0
        ? pct(((last - first) / first) * 100)
        : undefined,
    note: stamps.length > n ? `showing the most recent ${bars.length} of ${stamps.length} bars` : undefined,
  };
}

/** Ticker lookup, so Preston never guesses a symbol from a company name. */
export async function search(query: string): Promise<unknown[]> {
  const body = (await yahoo(`/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`)) as {
    quotes?: Record<string, unknown>[];
  };
  return (body.quotes ?? [])
    .filter((q) => q.symbol)
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname,
      type: q.quoteType,
      exchange: q.exchDisp,
      sector: q.sector,
      industry: q.industry,
    }));
}

/**
 * The headline indices in one call.
 *
 * Fans out because Yahoo's batch quote endpoint is Unauthorized without a
 * crumb. allSettled rather than all: one index failing should still leave
 * Preston with something to say about the other three.
 */
export async function marketSnapshot(): Promise<Record<string, unknown>> {
  const results = await Promise.allSettled(MARKET_INDICES.map((i) => quote(i.symbol)));
  const indices = results.flatMap((r, i) =>
    r.status === 'fulfilled'
      ? [{ label: MARKET_INDICES[i].label, ...r.value }]
      : [],
  );
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [MARKET_INDICES[i].label] : []));
  return { indices, unavailable: failed.length ? failed : undefined };
}

// ── SEC EDGAR ───────────────────────────────────────────────────────────────

/** The ticker→CIK map is ~10k entries and changes rarely; fetching it per tool
 *  call would add a second of latency to every fundamentals question. */
let cikCache: { at: number; map: Map<string, { cik: string; title: string }> } | null = null;

async function cikFor(symbol: string): Promise<{ cik: string; title: string }> {
  const want = symbol.trim().toUpperCase();
  if (!cikCache || Date.now() - cikCache.at > 24 * 60 * 60 * 1000) {
    const raw = (await sec(SEC_TICKERS_URL)) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const map = new Map<string, { cik: string; title: string }>();
    for (const row of Object.values(raw)) {
      if (!row?.ticker) continue;
      map.set(row.ticker.toUpperCase(), { cik: String(row.cik_str).padStart(10, '0'), title: row.title });
    }
    cikCache = { at: Date.now(), map };
  }
  const hit = cikCache.map.get(want);
  if (!hit) {
    throw new Error(
      `"${symbol}" is not a US-listed filer in SEC EDGAR. Foreign and private companies will not be here.`,
    );
  }
  return hit;
}

interface ConceptUnit {
  end?: string;
  val?: number;
  fy?: number;
  fp?: string;
  form?: string;
}

/** Most recent annual figure for one XBRL tag, or null if the company does not
 *  file under it (which is normal — see FUNDAMENTAL_TAGS). */
async function latestConcept(cik: string, tag: string): Promise<{ value: number; period: string; form: string } | null> {
  try {
    const body = (await sec(`${SEC_DATA_BASE}/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`)) as {
      units?: Record<string, ConceptUnit[]>;
    };
    const usd = body.units?.USD ?? [];
    // 10-K entries are the annual figures; quarterly 10-Qs would make the
    // numbers incomparable between companies.
    const annual = usd.filter((u) => u.form === '10-K' && typeof u.val === 'number' && u.end);
    const latest = annual.sort((a, b) => String(a.end).localeCompare(String(b.end))).pop();
    if (!latest) return null;
    return { value: latest.val!, period: latest.end!, form: latest.form! };
  } catch {
    return null; // a missing tag is an expected outcome, not an error
  }
}

export async function fundamentals(symbol: string): Promise<Record<string, unknown>> {
  const { cik, title } = await cikFor(symbol);
  const figures: Record<string, unknown> = {};

  await Promise.all(
    FUNDAMENTAL_TAGS.map(async ({ label, tags }) => {
      for (const tag of tags) {
        const hit = await latestConcept(cik, tag);
        if (hit) {
          figures[label] = { usd: hit.value, fiscal_period_end: hit.period, tag };
          return;
        }
      }
    }),
  );

  return {
    symbol: symbol.toUpperCase(),
    company: title,
    cik,
    source: 'SEC EDGAR XBRL company facts (as filed, annual 10-K figures)',
    figures,
    note: Object.keys(figures).length ? undefined : 'no matching us-gaap tags — this filer may use IFRS',
  };
}

export async function filings(symbol: string, limit = 10): Promise<Record<string, unknown>> {
  const { cik, title } = await cikFor(symbol);
  const body = (await sec(`${SEC_DATA_BASE}/submissions/CIK${cik}.json`)) as {
    name?: string;
    filings?: { recent?: { form?: string[]; filingDate?: string[]; primaryDocument?: string[]; accessionNumber?: string[]; reportDate?: string[] } };
  };
  const r = body.filings?.recent ?? {};
  const forms = r.form ?? [];
  const n = Math.min(Math.max(limit, 1), 25);

  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < forms.length && out.length < n; i++) {
    if (!INTERESTING_FORMS.includes(forms[i])) continue;
    const acc = (r.accessionNumber?.[i] ?? '').replace(/-/g, '');
    out.push({
      form: forms[i],
      filed: r.filingDate?.[i],
      period: r.reportDate?.[i] || undefined,
      url: acc && r.primaryDocument?.[i]
        ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${r.primaryDocument[i]}`
        : undefined,
    });
  }

  return { symbol: symbol.toUpperCase(), company: body.name ?? title, filings: out };
}

// ── FX ──────────────────────────────────────────────────────────────────────

export async function fxRate(from: string, to: string): Promise<Record<string, unknown>> {
  const base = from.trim().toUpperCase();
  const target = to.trim().toUpperCase();
  const body = (await getJson(`${FX_BASE}/latest?base=${base}&symbols=${target}`, {})) as {
    base?: string;
    date?: string;
    rates?: Record<string, number>;
  };
  const rate = body.rates?.[target];
  if (rate === undefined) {
    throw new Error(`no rate for ${base}->${target}. Use ISO codes like USD, EUR, JPY, GBP.`);
  }
  return { from: body.base ?? base, to: target, rate, as_of: body.date };
}
