/**
 * The market data catalog.
 *
 * Configuration, not documentation — the server builds its behaviour from
 * these constants, so they cannot drift away from what is actually served.
 *
 * Every endpoint here was verified live on 2026-08-29 and needs no API key.
 * That constraint is deliberate: the game must run on a fresh clone with an
 * empty .env, exactly like mcp/sf-guide.
 */

/**
 * Yahoo's chart endpoint carries both the live quote (in `meta`) and the OHLC
 * history (in `indicators`), which is why one host covers three of our tools.
 *
 * Two hosts, not one: query1 and query2 serve the same API and rate-limit
 * independently, so a block on one is survivable mid-demo. Note that the
 * sibling /v7/finance/quote batch endpoint returns Unauthorized without a
 * crumb — that is why market_snapshot fans out per symbol instead.
 */
export const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'] as const;

/** SEC requires a descriptive UA with contact info; requests without one are
 *  refused. See https://www.sec.gov/os/webmaster-faq#developers */
export const SEC_UA = 'quest-hero-hackathon (nordwebb@gmail.com)';
export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const SEC_DATA_BASE = 'https://data.sec.gov';

/** The .app host 301s to .dev; following redirects costs a round trip. */
export const FX_BASE = 'https://api.frankfurter.dev/v1';

export interface IndexSymbol {
  symbol: string;
  label: string;
}

/** What "how's the market doing" means, concretely. Kept short on purpose —
 *  market_snapshot fetches these in parallel and every extra symbol is another
 *  round trip the player waits through mid-conversation. */
export const MARKET_INDICES: IndexSymbol[] = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'Nasdaq Composite' },
  { symbol: '^DJI', label: 'Dow Jones Industrial Average' },
  { symbol: '^VIX', label: 'VIX (volatility)' },
];

/** Ranges Yahoo's chart endpoint accepts. Exposed to the model so it picks a
 *  valid one rather than discovering the set through failed calls. */
export const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'] as const;
export const INTERVALS = ['1d', '1wk', '1mo'] as const;

/**
 * XBRL tags we try, in order, for each headline figure.
 *
 * Companies do not agree on which us-gaap tag holds "revenue" — some file
 * Revenues, some RevenueFromContractWithCustomerExcludingAssessedTax. Trying a
 * list and taking the first that returns data is the difference between this
 * working for one company and working for most of them.
 */
export const FUNDAMENTAL_TAGS: { label: string; tags: string[] }[] = [
  {
    label: 'revenue',
    tags: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
    ],
  },
  { label: 'net_income', tags: ['NetIncomeLoss', 'ProfitLoss'] },
  { label: 'total_assets', tags: ['Assets'] },
  { label: 'total_liabilities', tags: ['Liabilities'] },
  { label: 'cash', tags: ['CashAndCashEquivalentsAtCarryingValue'] },
];

/** Filing forms worth surfacing. The rest of EDGAR is Form 4 insider noise
 *  that would crowd the agent's context without telling the player anything. */
export const INTERESTING_FORMS = ['10-K', '10-Q', '8-K', 'S-1', 'DEF 14A', '20-F'];
