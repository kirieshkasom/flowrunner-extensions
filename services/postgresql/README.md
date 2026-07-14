# PostgreSQL FlowRunner Extension

FlowRunner integration for [PostgreSQL](https://www.postgresql.org/) databases. Connects directly to a PostgreSQL server over TCP using the official [`pg`](https://node-postgres.com/) driver and exposes both raw SQL execution and convenient no-SQL row operations. It uses a **connect-per-call** model: every operation opens a short-lived `pg.Client`, runs its query, and always closes the connection when the call finishes — no connections or pools are cached between invocations.

## Ideal Use Cases

- Run parameterized SQL queries against an application or analytics database from within a workflow.
- Read, insert, update, delete, or upsert rows without writing SQL.
- Sync records between PostgreSQL and other apps (spreadsheets, CRMs, messaging tools).
- Discover a database's structure by listing tables/views and inspecting table schemas.
- Bulk-load arrays of records fetched from an API or another service into a table.

## List of Actions

### SQL

- **Execute Query** — run any SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs) using `$1, $2, ...` placeholders bound via the Parameters array; returns rows, affected count, and field metadata (120s execution limit).

### Rows

- **Select Rows** — read rows with column selection, equality filters, ordering, limit and offset.
- **Insert Row** — insert one row from a JSON object; returns the inserted row (`RETURNING *`).
- **Insert Rows** — bulk-insert an array of row objects in a single statement.
- **Update Rows** — update rows matching a non-empty Where object; returns the updated rows.
- **Delete Rows** — delete rows matching a non-empty Where object; returns the deleted count.
- **Upsert Row** — `INSERT ... ON CONFLICT ... DO UPDATE` keyed by the given conflict columns.

### Schema

- **Get Table Schema** — column names, types, nullability, defaults, and positions from `information_schema.columns`.
- **List Tables** — all tables and views in user schemas (system schemas excluded).

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation opens a short-lived `pg.Client`, runs its query, and always closes the connection when the call finishes (success or failure). No connections or pools are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call.

- Connection establishment is bounded by the configurable **Connection Timeout** (default 10 seconds).
- Statements are bounded by a 120-second `statement_timeout`.

## Configuration

Connect with either a single connection string (the copy-paste URI Supabase, Neon, RDS, Heroku etc. provide) or individual fields. When Connection String is set it takes precedence and the individual fields are ignored.

| Setting | Required | Description |
| --- | --- | --- |
| Connection String | No | Full PostgreSQL URI, e.g. `postgresql://user:password@db.example.com:5432/mydb`. Takes precedence over the fields below. Special characters in the password must be URL-encoded. |
| Host | No* | Hostname or IP address of the PostgreSQL server. Must be reachable from FlowRunner. |
| Port | No | TCP port (default `5432`). |
| Database | No* | Database name to connect to. |
| User | No* | Database user (role) name. |
| Password | No* | Password for the database user. |
| Use SSL/TLS | No | Enable TLS-encrypted connections. Required by most managed databases (AWS RDS, Google Cloud SQL, Azure Database, Heroku Postgres). Certificate verification is relaxed to support managed providers' default certificates. With a connection string, enabling this adds TLS on top of the URI; when off, any `sslmode` in the URI still applies. |
| Connection Timeout (seconds) | No | How long to wait when establishing a connection (default `10`). |

\* Required when no Connection String is provided.

> **Supabase:** use the **Session pooler** connection string from the dashboard's Connect dialog (`postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432`). The direct `db.<project-ref>.supabase.co` endpoint is IPv6-only and typically unreachable from FlowRunner (`ENETUNREACH`). Enable **Use SSL/TLS**.

## Safety Notes

- All **values** are bound as query parameters (`$1, $2, ...`) — never interpolated into SQL.
- **Identifiers** (table and column names) cannot be bound as parameters, so they are escaped with double-quote doubling before being placed in SQL.
- Table names may be schema-qualified (`analytics.events`); unqualified names default to the `public` schema.
- In `Where` condition objects: `null` values match `IS NULL`, array values match any element (`= ANY(...)`), all other values use equality; conditions are combined with `AND`.
- **Update Rows** and **Delete Rows** require a non-empty `Where` object to prevent accidental full-table writes. Use Execute Query for intentional unconditional statements.

## Agent Ideas

- Use PostgreSQL "Execute Query" to pull the latest sales figures, then use **Google Sheets** "Add Rows" to append them to a reporting spreadsheet for stakeholders.
- Use **Google Sheets** "Get Rows" to read a batch of records and PostgreSQL "Insert Rows" (or "Upsert Row") to sync them into a database table.
- After a PostgreSQL "Select Rows" query surfaces records needing attention (e.g. overdue accounts), use **Gmail** "Send Message" or **Slack** "Send Message To Channel" to notify the responsible team.
