# QuestDB FlowRunner Extension

Run SQL against a [QuestDB](https://questdb.io) high-performance, column-oriented time-series SQL database from FlowRunner using its HTTP REST API. Execute queries and DDL/DML statements returning a JSON dataset, export full result sets as CSV, and validate connectivity. Authenticates via optional HTTP Basic auth.

## Ideal Use Cases

- Query time-series metrics, events, or IoT sensor data and feed the results into downstream automation
- Insert or update rows and run DDL (CREATE/DROP/ALTER TABLE) as part of a workflow
- Export query results as CSV for spreadsheets, files, or downstream CSV processing
- Validate connectivity and authentication before running production queries

## List of Actions

### Query

- Execute Query
- Export Query as CSV

### System

- Check Health

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| REST Endpoint URL | Yes | QuestDB REST endpoint, e.g. `http://host:9000`. Any trailing slash is stripped automatically. |
| Username | No | Username for HTTP Basic auth. Only needed if authentication is enabled on your instance. |
| Password | No | Password for HTTP Basic auth. Only needed if authentication is enabled. |

By default an open-source QuestDB instance has no auth, so username/password can be left blank. When either credential is set, the service adds an `Authorization: Basic base64('{username}:{password}')` header to every request. All requests are sent to the base REST endpoint you configure (typically port `9000`).

## Notes

- **Row Limit** accepts either a single count (`"100"`, first N rows) or a 1-based inclusive range (`"10,20"`, rows 10 through 20).
- **Execute Query** (`/exec`) returns the executed `query`, a `columns` array of `{name, type}`, a `dataset` of row arrays, a row `count`, and server-side `timings`. It supports SELECT plus DDL (CREATE/DROP/ALTER) and DML (INSERT/UPDATE). Optional flags let you include the total count or skip the `columns` metadata for a smaller payload.
- **Export Query as CSV** (`/exp`) returns the full result set as CSV text with a header row, supporting the same Row Limit parameter.
- **Check Health** runs a trivial `SELECT 1` through `/exec` and returns `{ healthy, url, latencyMs }`, validating that both the endpoint and your credentials work.
- On a SQL error QuestDB responds with HTTP `400` and a body like `{ "query": "...", "error": "...", "position": N }`. The service surfaces the message, the character `position`, and the status, e.g. `QuestDB SQL error [400]: unexpected token: FORM (position 7)`.
- **Import CSV (`POST /imp`)** is not exposed as an operation. To load data, use `INSERT` statements via **Execute Query**, or QuestDB's `/imp` endpoint directly for large bulk loads.

## Agent Ideas

- Use **QuestDB** "Execute Query" to pull the latest aggregated time-series metrics, then post a summary to a channel with **Slack** "Send Message To Channel"
- Use **QuestDB** "Export Query as CSV" to dump a result set, then load it into a spreadsheet with **Google Sheets** "Import from CSV" for reporting
- Read source records with **CrateDB** "Execute SQL", then persist them into a time-series store with **QuestDB** "Execute Query" to sync data across databases
