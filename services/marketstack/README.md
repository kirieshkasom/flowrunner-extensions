# Marketstack FlowRunner Extension

Access real-time, intraday, and historical stock market data from the [Marketstack](https://marketstack.com) API (v2). Retrieve end-of-day and intraday prices, stock splits and dividends, and reference data for tickers, exchanges, currencies, and timezones. Symbol parameters accept one or more comma-separated ticker symbols (e.g. `AAPL,MSFT,TSLA`).

## Ideal Use Cases

- Build automated daily reports of end-of-day stock prices for a watchlist of symbols
- Monitor intraday price movements at custom intervals for trading dashboards
- Track corporate actions by pulling stock split and dividend history
- Enrich CRM or spreadsheet records with company and exchange reference data by ticker symbol
- Sync market data into spreadsheets or databases for analysis and alerting

## List of Actions

### End-of-Day

- Get End-of-Day Data
- Get Latest End-of-Day Data
- Get End-of-Day for Date

### Intraday

- Get Intraday Data
- Get Latest Intraday Data

### Splits & Dividends

- Get Stock Splits
- Get Dividends

### Tickers

- List Tickers
- Get Ticker
- Get Ticker End-of-Day

### Exchanges

- List Exchanges
- Get Exchange
- Get Exchange Tickers

### Currencies & Timezones

- List Currencies
- List Timezones

## List of Triggers

This service does not define any triggers.

## Authentication

Marketstack uses an API access key passed as the `access_key` query parameter on every request. This service adds it automatically — you configure the key once.

| Config item | Required | Description |
| --- | --- | --- |
| API Access Key | Yes | Your Marketstack access key, sent as the `access_key` query parameter. Find it in Marketstack → Dashboard → API Access Key. |

Requests are made over HTTPS against the v2 API base, `https://api.marketstack.com/v2`.

## Notes

- **Symbols**: Most operations accept a `symbols` value as a comma-separated list of ticker symbols. The number allowed per request depends on your Marketstack plan.
- **Response shape**: List operations return a `{ "pagination": { "limit", "offset", "count", "total" }, "data": [ ... ] }` object. Page through results using `limit` and `offset`.
- **Coverage**: Intraday coverage depends on your subscription plan. Errors surface the Marketstack message and code (e.g. `Marketstack API error [validation_error]: ...`).

## Agent Ideas

- Use Marketstack **Get Latest End-of-Day Data** for a watchlist of symbols, then **Google Sheets** "Add Row" to append each day's closing prices into a tracking spreadsheet.
- Use Marketstack **Get Dividends** to pull upcoming distributions, then **Slack** "Send Message To Channel" to alert an investing channel with the dividend dates and amounts.
- Use Marketstack **Get Ticker** to enrich a company record with its name and exchange, then **HubSpot** "Create Contact" to store the reference data alongside your CRM entries.
