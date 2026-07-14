# CrateDB FlowRunner Extension

Run SQL against a CrateDB cluster over its SQL-over-HTTP endpoint (`POST /_sql`). Supports single parameterized statements as well as high-throughput batched writes via `bulk_args`, returning column names, rows, affected row counts, and query duration. Optional HTTP Basic authentication is applied when a username and password are configured.

## Ideal Use Cases

- Query time-series or IoT data stored in CrateDB and feed the resulting rows into downstream automation steps.
- Run INSERT/UPDATE/DELETE or DDL (CREATE/ALTER/DROP TABLE) as part of a workflow, using positional parameters to safely inject values without string concatenation.
- Bulk-load many records in a single batched request for efficient, high-throughput ingestion.

## List of Actions

### SQL

- Execute SQL
- Execute Bulk SQL

## List of Triggers

This service does not define any triggers.

## Configuration

- **HTTP Endpoint URL** (required) — Your CrateDB HTTP endpoint, e.g. `https://host:4200` (trailing slashes are stripped; the `/_sql` path is appended automatically).
- **Username** (optional) — Database user (default `crate`). Used with the password for HTTP Basic auth.
- **Password** (optional) — Database password. Leave blank if authentication is disabled.

HTTP Basic authentication (`base64('{username}:{password}')`) is applied only when a username is configured. If your cluster has authentication disabled, leave the password blank and no `Authorization` header is sent.

## Notes

- **Execute SQL** accepts an optional `args` array for positional parameters bound to `?` or `$1`, `$2` placeholders, and an "Include Column Types" flag that adds a `col_types` array of CrateDB data type IDs per column. Response shape: `{ "cols": [...], "rows": [...], "rowcount": N, "duration": ms }`.
- **Execute Bulk SQL** applies one parameterized statement to each set of parameters in `bulkArgs`, returning a `results` array with one `rowcount` per set (a rowcount of `-2` means that row failed at runtime). Bulk operations do not return rows, so SELECT is not supported.
- On failure, CrateDB returns a 4xx/5xx status with `{ "error": { "message": "...", "code": N } }`; the service surfaces the message, code, and HTTP status in the thrown error.

## Agent Ideas

- Use **CrateDB** "Execute SQL" to query recent records, then **Google Sheets** "Add Rows" to append the returned rows into a reporting spreadsheet.
- When a **Dropbox** "On New File" trigger fires, parse the file's records and call **CrateDB** "Execute Bulk SQL" to batch-insert them into a CrateDB table.
- After a **CrateDB** "Execute SQL" query detects an anomaly (e.g. rows above a threshold), use **Slack** "Send Message To Channel" to alert the team with the result summary.
