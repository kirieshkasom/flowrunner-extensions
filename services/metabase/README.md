# Metabase FlowRunner Extension

Connect FlowRunner to [Metabase](https://www.metabase.com/), the open-source business intelligence platform. Run saved questions and ad-hoc queries, manage cards, collections, dashboards, and databases, and export query results as JSON or CSV. Authenticates with your Metabase Server URL and an `x-api-key` API key.

## Ideal Use Cases

- Run a saved question (card) or ad-hoc SQL query on a schedule and route the rows into another system.
- Export query results as JSON or CSV to hand off to reporting, email, or spreadsheet steps.
- Programmatically create and update cards, dashboards, and collections to keep BI content in sync.
- Discover a database's tables and fields, then build a native SQL or structured MBQL query against it.
- Trigger a schema sync after upstream data-model changes so Metabase reflects new tables and columns.

## List of Actions

### Cards

- Create Card
- Delete Card
- Get Card
- List Cards
- Run Card Query
- Run Card Query Export
- Update Card

### Datasets

- Export Query
- Run Query

### Databases

- Get Database
- Get Database Metadata
- List Databases
- Sync Database Schema

### Collections

- Create Collection
- Get Collection Items
- List Collections

### Dashboards

- Create Dashboard
- Get Dashboard
- List Dashboards

### Users & Health

- Get Current User
- Health Check
- List Users

## List of Triggers

This service does not define any triggers.

## Authentication

Authenticate with a **Metabase API key**, sent on every request as the `x-api-key` header.

- **Server URL** — Your Metabase base URL, e.g. `https://myco.metabaseapp.com`. Trailing slashes are stripped; all calls go to `{Server URL}/api`.
- **API Key** — Create one in Metabase under Admin settings > Authentication > API keys > Create a key. The key inherits the permissions of its assigned group, so some operations (e.g. List Users) require an admin-level key.

Use **Get Current User** as a quick connection check once configured.

## Notes

- **Query model** — Query operations accept a native **SQL Query** or, for structured queries, a full **Query JSON** (MBQL) object; Query JSON takes precedence when both are supplied. SQL and ad-hoc queries require the target **Database ID**. Query JSON accepts either a bare MBQL query object (e.g. `{"source-table":2,"limit":10}`) or a full `dataset_query` object.
- **Pickers** — Card, database, and collection ID fields are backed by searchable dictionaries, so you can select objects by name instead of memorizing ids.
- **Errors** — Metabase returns error strings or `{ "message": "..." }` payloads. This service surfaces the message together with the HTTP status code, e.g. `Metabase API error (403): You don't have permissions to do that.`

## Agent Ideas

- Use **Metabase** "Run Card Query Export" to pull a saved report as CSV, then use **Gmail** "Send Message" to email the export to stakeholders on a schedule.
- Use **Metabase** "Run Query" to execute an ad-hoc SQL query, then use **Google Sheets** "Add Row" to append each result row into a live tracking spreadsheet.
- After **Metabase** "Run Card Query" returns anomalous metrics, use **Slack** "Send Message To Channel" to post a summary alert to the analytics channel.
