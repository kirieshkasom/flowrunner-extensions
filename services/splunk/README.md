# Splunk FlowRunner Extension

Integrates FlowRunner with Splunk's REST management API and HTTP Event Collector (HEC) to run SPL searches, manage saved searches, ingest events, and inspect indexes and server health.

## Ideal Use Cases

- Run an SPL search on a schedule and route the results into alerts, tickets, or dashboards
- Ingest application, workflow, or webhook events into Splunk for centralized logging and monitoring
- Trigger a saved search or alert from an automation and act on its results
- Monitor index sizes, event counts, and server health as part of an operational workflow

## List of Actions

### Search

- Cancel Search Job
- Create Search Job
- Get Search Job Status
- Get Search Results
- Run Oneshot Search

### Saved Searches

- Get Saved Search
- List Saved Searches
- Run Saved Search

### HTTP Event Collector

- Send Event
- Send Raw Event

### Indexes

- Get Index
- List Indexes

### Server

- Get Server Info

## List of Triggers

This service does not define any triggers.

## Configuration

Two independent endpoints, each with its own port and token:

- **Management URL** — REST endpoint, e.g. `https://myhost:8089` (strip any trailing slash). Authenticated with the Bearer **Auth Token** (`Authorization: Bearer <token>`); create one under Splunk Settings → Tokens. Powers all Search, Saved Searches, Indexes, and Server actions. Every REST call forces `output_mode=json` because Splunk returns XML by default.
- **HEC URL** — HTTP Event Collector endpoint, e.g. `https://myhost:8088` (strip any trailing slash). Authenticated with the **HEC Token** (`Authorization: Splunk <token>`). Required only for Send Event / Send Raw Event; the target index and sourcetype must be permitted by the HEC token's configuration.

## Notes

- The standard async search flow is: **Create Search Job** (returns a `sid`) → poll **Get Search Job Status** until `isDone` is `1` → **Get Search Results** with the `sid`; optionally **Cancel Search Job** to free resources. For small, time-bounded searches use **Run Oneshot Search** to get results in a single call (`exec_mode=oneshot`).
- SPL queries must start with `search ` unless they begin with a generating command (e.g. `tstats`, `metadata`, `inputlookup`, or a leading `|`) — for example `search index=main sourcetype=access_combined status=500 | stats count by uri`.
- Use `count`/`offset` to page through large result sets and collections; `count` 0 returns all available results.
- Splunk errors (`{ messages: [...] }` for REST, `{ text, code }` for HEC) are joined with the HTTP status into a single `Splunk API error: ...` message.

## Agent Ideas

- After **Splunk** "Run Oneshot Search" surfaces errors matching an SPL query, use **Slack** "Send Message To Channel" to post the offending events to an on-call channel.
- When a **Splunk** saved-search alert run via "Run Saved Search" returns results, use **PagerDuty** "Create Incident" to open an incident for the responding team.
- After **Splunk** "Get Search Results" returns a metrics summary, use **Grafana** "Create Annotation" to mark the corresponding event on a dashboard timeline.
