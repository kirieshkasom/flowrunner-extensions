# CoinGecko FlowRunner Extension

Access live and historical cryptocurrency market data from the [CoinGecko API v3](https://docs.coingecko.com/reference/introduction): current prices, coin and token pricing, market charts, OHLC candles, trending coins, exchange and category data, and global market statistics. Works keyless against the rate-limited free tier, or with a Demo or Pro API key for higher limits.

## Ideal Use Cases

- Fetch current prices for a portfolio of coins or contract-addressed tokens and log or notify on changes
- Build crypto leaderboards and dashboards from market, category, and global data
- Pull historical prices, OHLC candles, and market charts for analysis or reporting
- Surface trending coins and search results to enrich alerts and content
- Verify API connectivity and plan validity before running downstream automations

## List of Actions

### System
- Ping

### Simple
- Get Price
- Get Token Price by Contract
- Supported VS Currencies

### Coins
- List Coins
- Coins Markets
- Get Coin Data
- Get Coin Market Chart
- Get Coin OHLC
- Get Coin History

### Search & Trending
- Search
- Trending

### Global
- Global Data
- Global DeFi Data

### Exchanges
- List Exchanges
- Get Exchange

### Categories
- List Categories

## List of Triggers

This service does not define any triggers.

## Configuration

CoinGecko offers two access modes, selected via the **Plan** config item:

| Plan | Base URL | Auth header |
| --- | --- | --- |
| **Demo** (default) | `https://api.coingecko.com/api/v3` | `x-cg-demo-api-key: {apiKey}` |
| **Pro** | `https://pro-api.coingecko.com/api/v3` | `x-cg-pro-api-key: {apiKey}` |

| Item | Type | Required | Description |
| --- | --- | --- | --- |
| **API Key** | String | No | CoinGecko API key. Leave blank for the free public rate-limited tier. |
| **Plan** | Choice (`Demo`/`Pro`) | No | Demo key or free tier vs a paid Pro key. Defaults to `Demo`. |

- **Keyless free tier:** Leave **API Key** blank on the Demo plan to use the public, rate-limited endpoint (no key header is sent).
- **Demo key:** Create a free Demo key at CoinGecko → Developer Dashboard → API key for higher, more stable limits.
- **Pro key:** For paid plans, set **Plan** to `Pro` and supply your Pro API key.

The service selects the base URL and auth header automatically based on the Plan. The free/Demo tier is rate limited; an HTTP `429` response means the limit was exceeded — slow down requests or use a Pro API key.

## Agent Ideas

- Use CoinGecko **Get Price** to fetch the latest prices for a watchlist, then **Google Sheets** "Add Row" to append each price snapshot to a tracking spreadsheet
- Call CoinGecko **Trending** each morning and post the top trending coins to a channel with **Slack** "Send Message To Channel"
- Pull market data with CoinGecko **Coins Markets** and store each coin's rank, price, and market cap using **Airtable** "Create Record" for a maintained crypto database
