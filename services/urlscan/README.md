# urlscan.io FlowRunner Extension

Scan and analyze URLs with [urlscan.io](https://urlscan.io). Submit a URL for a full browser-based scan, retrieve the analysis (contacted domains/IPs, requests, technologies, verdicts), search the historical scan database, and download page screenshots and DOM snapshots. Authenticates with an API key sent as the `API-Key` header.

## Ideal Use Cases

- Detonate suspicious links from emails, tickets, or chat to check for phishing, malware, or brand abuse before users click them.
- Enrich threat-intelligence workflows by searching urlscan.io's historical database (ElasticSearch query syntax) for a domain, IP, hash, or filename.
- Capture full-page screenshots and rendered DOM of a page for evidence, monitoring, or visual review.
- Check remaining API quota before running batch scans.

## List of Actions

### Scanning

- Submit Scan
- Get Scan Result
- Scan and Wait

### Search

- Search Scans

### Artifacts

- Get Screenshot
- Get DOM Snapshot
- Get Live Screenshot

### Account

- Get Quotas

## List of Triggers

This service does not define any triggers.

## The scan lifecycle (submit → wait → result)

urlscan.io scanning is **asynchronous**. Submitting a URL does not return the analysis; it returns a scan `uuid` and result links. The scan runs in a real browser and takes roughly **10–30 seconds** to complete.

1. **Submit Scan** — POST the URL; get back `{ uuid, api, result, visibility }`.
2. **Wait** ~10–30 seconds. **Get Scan Result** returns **HTTP 404** until the scan is finished (surfaced here as a "not ready" error). A deleted scan returns HTTP 410.
3. **Get Scan Result** — once ready, returns the full analysis.

**Shortcut:** **Scan and Wait** performs the submit-and-poll loop for you in a single operation — it submits, waits ~8 seconds, then polls every 5 seconds up to a ~40 second timeout and returns the finished result (`ready: true`). If the scan is still running at timeout it returns `ready: false` with the `uuid` so you can fetch it later with Get Scan Result.

## Notes

- **Visibility:** *Public* scans appear in the community feed and are searchable by everyone; *Unlisted* scans are hidden from the feed but reachable via their link; *Private* scans are visible only to your account.
- **Search syntax:** **Search Scans** uses ElasticSearch query string syntax — field filters such as `domain:example.com`, `page.url:"login"`, `ip:1.2.3.4`, `filename:*.exe`, `hash:<sha256>`, plus boolean operators (`AND`, `OR`, `NOT`). Use `size` for page size and `search_after` (the `sort` value from the last result of a page) to paginate.
- **Artifacts:** Screenshots and DOM snapshots are only available after a scan completes. **Get Screenshot** and **Get Live Screenshot** store the PNG in FlowRunner file storage and return a downloadable URL; **Get DOM Snapshot** returns the rendered DOM (HTML) as text.
- **Rate limiting:** urlscan.io enforces per-action rate limits. When exceeded, the API returns **HTTP 429** and this service surfaces a clear message. Respect the `X-Rate-Limit-*` response headers and back off before retrying; only successful (HTTP 200) requests count against your quota. Use **Get Quotas** to check remaining capacity.

## Configuration

| Config item | Required | Description |
|-------------|----------|-------------|
| API Key     | Yes      | Your urlscan.io API key, sent as the `API-Key` header. Get it from **urlscan.io → Settings & API → API key**. |

## Agent Ideas

- When a **Slack** "On Channel Message" trigger surfaces a suspicious link, run urlscan.io **Submit Scan** then **Get Scan Result** and reply with **Slack** "Send Message To Channel" summarizing the verdict and screenshot link.
- Use urlscan.io **Search Scans** to find recent scans of a phishing domain, then **PagerDuty** "Create Incident" to open an investigation when malicious verdicts are found.
- After urlscan.io **Scan and Wait** completes, log the URL, verdict, and screenshot URL from **Get Screenshot** into a tracking sheet with **Google Sheets** "Add Row".
