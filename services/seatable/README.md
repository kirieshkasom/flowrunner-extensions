# SeaTable FlowRunner Extension

Connect FlowRunner to a [SeaTable](https://seatable.io) base to read, write, link, and query rows. SeaTable is a no-code, Airtable-style collaborative database with a REST API and a genuine SQL query engine over your base data. Works with both SeaTable Cloud and self-hosted servers. You configure a long-lived Base API Token, which the extension transparently exchanges for the short-lived base access token used against the API gateway (cached and re-exchanged automatically on expiry).

## Ideal Use Cases

- Sync records between SeaTable and other apps by appending or updating rows in bulk (up to 1000 per request)
- Log form submissions, events, or webhook payloads as new rows in a base
- Query and aggregate base data on demand with read-only SQL (`WHERE`, `ORDER BY`, `GROUP BY`, `JOIN`, `LIMIT`)
- Maintain relationships between tables by adding and removing row links
- Discover table and column names dynamically before performing data operations

## List of Actions

### Metadata

- Get Base Metadata

### Rows

- List Rows
- Get Row
- Append Row
- Append Rows
- Update Row
- Update Rows
- Delete Row
- Delete Rows

### SQL

- Query with SQL

### Links

- Add Link
- List Row Links
- Remove Link

## List of Triggers

This service does not define any triggers.

## Authentication

SeaTable uses a **two-tier token model**:

1. **Base API Token (what you configure).** A long-lived token scoped to a single base. In SeaTable, open your base, click the **...** menu, choose **Advanced → API Tokens**, and create a Base API Token. It is sent as `Authorization: Token <token>` only during the exchange below.
2. **Base access token (handled automatically).** The extension exchanges your Base API Token for a short-lived base access token (valid ~3 days) via `GET {serverUrl}/api/v2.1/dtable/app-access-token/`. That exchange also returns the base's `dtable_uuid` and the API gateway URL (`dtable_server`) used for all data operations. Every base/row/SQL/link call is then sent to `{gateway}api/v2/dtables/{dtable_uuid}/...` with `Authorization: Bearer <base access token>`. The context is cached and transparently re-exchanged if the token expires (401/403).

You never manage the base access token yourself — only the Base API Token.

> **SeaTable 5.3+ only.** All base operations route through the API gateway (`api-gateway/api/v2`). The legacy `dtable-server` / `dtable-db` v1 endpoints were removed in SeaTable 5.3 and are no longer used.

### Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Server URL** | No | SeaTable server. Defaults to `https://cloud.seatable.io` for SeaTable Cloud. Self-hosters set their own server URL (trailing slashes are stripped). |
| **API Token** | Yes | Your Base API Token (see above). Scoped to a single base. |

**Cloud vs. self-hosted:** leave Server URL at the default for SeaTable Cloud. If you run your own SeaTable server, set Server URL to your instance (for example `https://seatable.example.com`); if the token-exchange response omits a gateway URL, the extension falls back to `{serverUrl}/api-gateway/`.

> A Base API Token is tied to a single base, so one connection maps to one base. Create a separate connection per base you want to automate.

## Notes

- SeaTable identifies **tables by name** (not ID) in the row API, and row objects are keyed by **column name** (not column key) for append and update operations. The bundled *Get Tables* and *Get Columns* dictionaries (and Get Base Metadata) populate these values in the UI.
- **List Rows** supports selecting a view and start/limit pagination (max 1000 rows per request).
- **Query with SQL** runs read-only `SELECT` statements against base tables; result column keys are converted to human-readable names.
- Errors from the SeaTable API are surfaced using the API's `error_msg` / `detail` fields.

## Agent Ideas

- Use **SeaTable** "Query with SQL" to pull rows matching a condition, then send a digest via **Gmail** "Send Message" or post it with **Slack** "Send Message To Channel".
- When new records arrive in **Google Sheets**, use "Get Rows" to read them and **SeaTable** "Append Rows" to bulk-sync them into a base table.
- Use **Notion** "Create Page" for items flagged in a **SeaTable** "List Rows" result, then call **SeaTable** "Update Row" to record the created Notion page reference back on each row.
