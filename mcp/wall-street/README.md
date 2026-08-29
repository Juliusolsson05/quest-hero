# Wall Street — MCP server

Live public-market data as MCP tools, for an NPC who is convinced the medieval
economy is just an illiquid market.

**Status:** working and verified against the running harness. TrueForge lists
all 7 tools; calls return live quotes, real index levels, and official SEC
filings. Nothing here is stubbed, and nothing needs an API key.

**It is self-contained.** One directory, no shared code, no database, no
credentials. It only needs TrueForge to be able to reach its URL.

---

## Run it

```bash
cd mcp/wall-street
npm install --include=dev     # --include=dev matters, see Gotchas
npm run dev                   # http://localhost:8812/mcp
curl localhost:8812/health    # {"ok":true,"tools":7,"keys_required":0}
npm run smoke                 # hits all 7 tools against live endpoints
```

Port via `WALL_STREET_PORT`. Default 8812, chosen to avoid TrueForge (8790),
Vite (5173), the World Hub (7777) and sf-guide (8811).

## Register it in TrueForge

```bash
curl -X PUT http://localhost:8790/api/v1/settings/mcp-servers \
  -H 'content-type: application/json' \
  -d '{"manifest":{
    "type":"remote",
    "name":"wall-street",
    "url":"http://localhost:8812/mcp",
    "description":"Live stock market data: quotes, price history, market indices, official SEC filings and fundamentals, and FX rates. No API keys."
  }}'

curl localhost:8790/api/v1/mcp-servers/wall-street/tools   # confirm it connected
```

The hub attaches it to Preston alone, via `connectors: ['wall-street']` on his
seed in `hub/src/npcs.ts`. Give it to **this character only** — the joke stops
working if the blacksmith can also pull a quote, and withholding a tool is far
more reliable than instructing a model not to use one.

---

## The character

**Preston. Public markets. Puffer vest. Permanently mid-trade.**

He is the counterpart to Chad: Chad deals in private companies and feelings,
Preston deals in public markets and actual numbers, and he enjoys the
distinction enormously. He set up beside the market stalls because it is called
the market and that was good enough for him.

**The two hard rules:**

1. **He never states a figure he did not fetch.** Every number he says came
   from a tool call the player can watch happen.
2. **He never gives investment advice.** Asked for a recommendation, he quotes
   the real numbers and then deflects in character — *"not advice, I'm a man in
   a puffer vest yelling quotes beside an anvil"*. The deflection is the joke,
   and it is also the reason a character with live market data behind him is
   safe to ship.

He also writes plain text only. Speech bubbles render via `textContent`, so
markdown arrives as literal asterisks — and he is the only NPC who quotes
figures, which is exactly what tempts a model into bolding things.

---

## The tools

| Tool | What it does |
| --- | --- |
| `stock_search` | Company name → ticker, with sector. Call first when unsure. |
| `stock_quote` | Price, change %, day range, 52-week range, volume. |
| `stock_history` | OHLC bars over a range, plus total change across it. |
| `market_snapshot` | S&P 500, Nasdaq, Dow and VIX at once. |
| `company_fundamentals` | Revenue, net income, assets — from SEC 10-K filings. |
| `company_filings` | Recent 10-K / 10-Q / 8-K with links. |
| `fx_rate` | ECB reference rate between two currencies. |

### Where the data comes from

**Yahoo Finance** (`/v8/finance/chart`) — quotes and history. One endpoint
carries both, which is why three tools share it.

**SEC EDGAR** — official XBRL company facts and the filing index. These are
numbers as filed, not estimates, which is the whole reason `company_fundamentals`
is worth having next to a price feed.

**Frankfurter** — ECB reference FX rates.

### Questions that show it off

Single lookups are unimpressive. The demo is watching him chain sources:

> *"Is NVIDIA actually making money or is it just hype?"*
> quote + fundamentals — the price, then the revenue behind it.

> *"Has anything happened at Tesla lately?"*
> filings — an 8-K means something did.

> *"How's the market?"* — he answers with four live indices, in a fantasy village.

> *"Should I buy?"* — he tells you the numbers and then refuses, in character.

---

## Gotchas

**`npm install` needs `--include=dev`** on this machine. `NODE_ENV=production`
is set in the shell environment, which makes npm silently skip every
devDependency — the build then fails on missing types with no obvious cause.
Same trap as `mcp/sf-guide`.

**Yahoo's batch quote endpoint is dead to us.** `/v7/finance/quote?symbols=a,b,c`
returns `Unauthorized` without a session crumb, so `market_snapshot` fans out
one chart request per index instead. Do not "optimise" it back into a batch.

**Two Yahoo hosts, on purpose.** `query1` and `query2` serve the same API and
rate-limit independently. A 429 on one silently retries the other, because the
failure we cannot afford is the one that happens live in front of judges.

**Index symbols have no change percent.** Yahoo omits
`regularMarketChangePercent` on `^GSPC` and friends, so `quote()` computes the
change from `chartPreviousClose` itself. The smoke test asserts this
specifically — it is the thing that broke first.

**Companies disagree about which XBRL tag means "revenue".** Some file
`Revenues`, some `RevenueFromContractWithCustomerExcludingAssessedTax`.
`FUNDAMENTAL_TAGS` tries a list per figure and takes the first that returns
data; that list is the difference between this working for one company and
working for most.

**SEC requires a descriptive User-Agent** with contact info. Requests without
one are refused outright.

**Only US filers are in EDGAR.** `company_fundamentals` on a foreign or private
company returns a readable error saying so, which the model can recover from.

**Tool errors are returned as content, not thrown** — same as sf-guide. A wrong
ticker comes back as a message that tells the model to try `stock_search`,
rather than a protocol error it cannot reason about.

## Testing

`npm run smoke` hits all seven tools live and asserts on the fields the tools
actually read. It is not a unit test and it should not become one: every
dependency here is a third-party endpoint we do not control, so the failure
that actually happens is an upstream shape change, and no mock would catch it.
