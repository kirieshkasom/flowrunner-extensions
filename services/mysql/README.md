# MySQL FlowRunner Extension

FlowRunner integration for [MySQL](https://www.mysql.com/) databases (including MySQL-compatible servers such as MariaDB, PlanetScale and Aurora MySQL). Connects directly to a MySQL server over TCP using the [`mysql2`](https://sidorares.github.io/node-mysql2/docs) driver and exposes both raw SQL execution and convenient no-SQL row operations. It uses a **connect-per-call** model: every operation opens a short-lived connection, runs its query, and always closes the connection when the call finishes — no connections or pools are cached between invocations.

## Ideal Use Cases

- Run parameterized SQL queries against an application or analytics database from within a workflow.
- Read, insert, update, delete, or upsert rows without writing SQL.
- Sync records between MySQL and other apps (spreadsheets, CRMs, messaging tools).
- Discover a database's structure by listing tables/views and inspecting table schemas.
- Bulk-load arrays of records fetched from an API or another service into a table.

## List of Actions

### SQL

- **Execute Query** — run any single SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs) using `?` placeholders bound via the Parameters array; returns rows and field metadata for reads, or `affectedRows`/`insertId`/`changedRows` for writes (120s execution limit).

### Rows

- **Select Rows** — read rows with column selection, equality filters, ordering, limit and offset.
- **Insert Row** — insert one row from a JSON object; returns `insertId`, `affectedRows` and an echo of the data.
- **Insert Rows** — bulk-insert an array of row objects in a single statement; returns the inserted count and the first auto-increment ID.
- **Update Rows** — update rows matching a non-empty Where object; returns `affectedRows` (matched) and `changedRows` (actually modified).
- **Delete Rows** — delete rows matching a non-empty Where object; returns `affectedRows`.
- **Upsert Row** — `INSERT ... ON DUPLICATE KEY UPDATE` keyed by the table's PRIMARY KEY / UNIQUE indexes; the Unique Columns parameter is only excluded from the update set.

### Schema

- **Get Table Schema** — column names, full types, nullability, defaults, key membership and extra attributes from `information_schema.columns`.
- **List Tables** — all tables and views in the current database.

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation opens a short-lived `mysql2` connection, runs its query, and always closes the connection when the call finishes (success or failure). No connections or pools are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call.

- Connection establishment is bounded by the configurable **Connection Timeout** (default 10 seconds).
- Execute Query is bounded by a 120-second FlowRunner execution limit.

## Configuration

Connect with either a single connection string (the copy-paste URI PlanetScale, Aiven, RDS, DigitalOcean etc. provide) or individual fields. When Connection String is set it takes precedence and the individual fields are ignored.

| Setting | Required | Description |
| --- | --- | --- |
| Connection String | No | Full MySQL URI, e.g. `mysql://user:password@db.example.com:3306/mydb`. Takes precedence over the fields below. Special characters in the password must be URL-encoded. |
| Host | No* | Hostname or IP address of the MySQL server. Must be reachable from FlowRunner. |
| Port | No | TCP port (default `3306`). |
| Database | No* | Database (schema) name to connect to. |
| User | No* | Database user name. |
| Password | No* | Password for the database user. |
| Use SSL/TLS | No | Enable TLS-encrypted connections. Required by most managed databases (PlanetScale, Aiven, AWS RDS, Azure Database). Certificate verification is relaxed to support managed providers' default certificates. With a connection string, enabling this adds TLS on top of the URI; when off, any `ssl` parameters in the URI still apply. |
| Connection Timeout (seconds) | No | How long to wait when establishing a connection (default `10`). |

\* Required when no Connection String is provided.

> **Managed hosts (PlanetScale, Aiven, Azure, etc.):** these providers typically refuse unencrypted connections — enable **Use SSL/TLS**. If the database host resolves to an IPv6-only address, connections may fail with `ENETUNREACH`; use an IPv4-compatible hostname or endpoint.

## Safety Notes

- All **values** are bound as query parameters (`?` placeholders) — never interpolated into SQL. Limit/Offset are the only inlined values and are strictly validated as non-negative integers first.
- **Identifiers** (table and column names) cannot be bound as parameters, so they are escaped with backtick doubling before being placed in SQL.
- Table names may be database-qualified (`analytics.events`); unqualified names use the database of the current connection.
- In `Where` condition objects: `null` values match `IS NULL`, array values match any element (`IN (...)`, an empty array matches nothing), all other values use equality; conditions are combined with `AND`.
- **Update Rows** and **Delete Rows** require a non-empty `Where` object to prevent accidental full-table writes. Use Execute Query for intentional unconditional statements.
- MySQL has no `RETURNING` clause: writes return `insertId`/`affectedRows`/`changedRows` rather than the full row. Fetch the row with Select Rows when database-generated values are needed.

## Agent Ideas

- Use MySQL "Execute Query" to pull the latest sales figures, then use **Google Sheets** "Add Rows" to append them to a reporting spreadsheet for stakeholders.
- Use **Google Sheets** "Get Rows" to read a batch of records and MySQL "Insert Rows" (or "Upsert Row") to sync them into a database table.
- After a MySQL "Select Rows" query surfaces records needing attention (e.g. overdue accounts), use **Gmail** "Send Message" or **Slack** "Send Message To Channel" to notify the responsible team.
