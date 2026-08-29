/**
 * Live smoke test: `npm run smoke`.
 *
 * Not a unit test. Every fetcher here talks to a third-party endpoint we do not
 * control, so the failure that actually happens is an upstream shape change —
 * Yahoo renaming a meta field, SEC moving a path — and no mock would catch it.
 * This hits all seven tools for real and asserts on the fields the tools
 * actually read, so a breakage names itself instead of surfacing as an NPC who
 * has mysteriously gone quiet mid-demo.
 *
 * Exits non-zero if any check fails.
 */
import { filings, fundamentals, fxRate, history, marketSnapshot, quote, search } from './fetchers.js';

let failures = 0;

async function check(name: string, fn: () => Promise<unknown>, assert: (v: any) => string | null): Promise<void> {
  const started = Date.now();
  try {
    const value = await fn();
    const problem = assert(value);
    const ms = Date.now() - started;
    if (problem) {
      failures++;
      console.log(`✗ ${name} (${ms}ms) — ${problem}`);
    } else {
      console.log(`✓ ${name} (${ms}ms)`);
    }
  } catch (e) {
    failures++;
    console.log(`✗ ${name} — threw: ${e instanceof Error ? e.message : e}`);
  }
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

await check('stock_quote NVDA', () => quote('NVDA'), (v) =>
  !num(v.price) ? `no numeric price (got ${JSON.stringify(v.price)})`
  : !num(v.change_pct) ? 'no change_pct — Yahoo may have changed chartPreviousClose'
  : v.symbol !== 'NVDA' ? `symbol came back as ${v.symbol}`
  : null);

await check('stock_quote ^GSPC (index)', () => quote('^GSPC'), (v) =>
  // Indices are the case that broke first: Yahoo omits regularMarketChangePercent
  // for them, which is why quote() computes the change itself.
  !num(v.price) ? 'no price for the S&P'
  : !num(v.change_pct) ? 'index change_pct missing — the computed-change path regressed'
  : null);

await check('stock_search "nvidia"', () => search('nvidia'), (v) =>
  !Array.isArray(v) ? 'not an array'
  : v.length === 0 ? 'no results'
  : !v.some((r: any) => r.symbol === 'NVDA') ? 'NVDA not in results for "nvidia"'
  : null);

await check('stock_history AAPL 6mo', () => history('AAPL', '6mo', '1wk', 30), (v) =>
  !Array.isArray(v.bars) ? 'bars is not an array'
  : v.bars.length < 5 ? `only ${v.bars.length} bars`
  : !num(v.bars[0].close) ? 'bars have no numeric close'
  : !num(v.change_over_range_pct) ? 'no change_over_range_pct'
  : null);

await check('market_snapshot', () => marketSnapshot(), (v) =>
  !Array.isArray(v.indices) ? 'indices is not an array'
  : v.indices.length < 3 ? `only ${v.indices.length} indices resolved (${JSON.stringify(v.unavailable)})`
  : null);

await check('company_fundamentals NVDA', () => fundamentals('NVDA'), (v) =>
  v.cik !== '0001045810' ? `wrong CIK: ${v.cik}`
  : !v.figures?.revenue ? 'no revenue figure — check FUNDAMENTAL_TAGS against current us-gaap tags'
  : !num(v.figures.revenue.usd) ? 'revenue is not numeric'
  : null);

await check('company_filings NVDA', () => filings('NVDA', 5), (v) =>
  !Array.isArray(v.filings) ? 'filings is not an array'
  : v.filings.length === 0 ? 'no filings returned'
  : !v.filings[0].form ? 'filing rows have no form'
  : null);

await check('fx_rate USD->EUR', () => fxRate('USD', 'EUR'), (v) =>
  !num(v.rate) ? 'no numeric rate' : v.rate <= 0 ? `implausible rate ${v.rate}` : null);

// Bad input must come back as a readable message the model can recover from,
// not a crash — this is the contract that lets Preston retry via stock_search.
await check('unknown ticker is a clean error', async () => {
  try { await quote('NOTAREALTICKER'); return 'resolved'; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}, (v) =>
  v === 'resolved' ? 'a bogus ticker resolved instead of erroring'
  : typeof v === 'string' && v.length > 0 ? null
  : 'error had no message');

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
