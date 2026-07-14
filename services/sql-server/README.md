# Microsoft SQL Server FlowRunner Extension

FlowRunner integration for [Microsoft SQL Server](https://www.microsoft.com/sql-server) (including Azure SQL Database). Connects directly to a SQL Server instance over TCP using the [`mssql`](https://www.npmjs.com/package/mssql) driver and exposes both raw T-SQL execution and convenient no-SQL row operations. It uses a **connect-per-call** model: every operation opens a short-lived connection, runs its query, and always closes the connection when the call finishes — no connections or pools are cached between invocations.

## Ideal Use Cases

- Run parameterized T-SQL queries against an application or analytics database from within a workflow.
- Read, insert, update, delete, or upsert rows without writing SQL.
- Sync records between SQL Server and other apps (spreadsheets, CRMs, messaging tools).
- Discover a database's structure by listing tables and inspecting table schemas.
- Bulk-load arrays of records fetched from an API or another service into a table.

## List of Actions

### SQL

- **Execute Query** — run any T-SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs, EXEC) using `@p1, @p2, ...` placeholders bound via the Parameters array; returns the recordset and affected row counts (120s execution limit).

### Rows

- **Select Rows** — read rows with column selection, equality filters, ordering, limit and offset (`TOP` / `OFFSET ... FETCH`).
- **Insert Row** — insert one row from a JSON object; returns the inserted row (`OUTPUT INSERTED.*`).
- **Insert Rows** — bulk-insert an array of row objects in a single statement.
- **Update Rows** — update rows matching a non-empty Where object; returns the updated rows.
- **Delete Rows** — delete rows matching a non-empty Where object; returns the deleted count.
- **Upsert Row** — `MERGE ... WHEN MATCHED THEN UPDATE WHEN NOT MATCHED THEN INSERT` keyed by the given key columns.

### Schema

- **Get Table Schema** — column names, types, nullability, defaults, and positions from `INFORMATION_SCHEMA.COLUMNS`.
- **List Tables** — all base tables in the database (views excluded).

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation creates a short-lived connection (a dedicated `ConnectionPool` limited to a single connection), runs its query, and always closes it when the call finishes (success or failure). No connections or pools are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call.

- Connection establishment is bounded by the configurable **Connection Timeout** (default 15 seconds).
- Statements are bounded by a 120-second request timeout.

## Configuration

Connect with either a single connection string (ADO.NET format — the copy-paste string Azure SQL and most hosting providers supply) or individual fields. When Connection String is set it takes precedence and the individual fields and TLS toggles are ignored.

| Setting | Required | Description |
| --- | --- | --- |
| Connection String | No | Full ADO.NET-style connection string, e.g. `Server=db.example.com,1433;Database=mydb;User Id=myuser;Password=mypassword;Encrypt=true`. Takes precedence over the fields below; include `Encrypt=` and `TrustServerCertificate=` in the string itself. |
| Host | No* | Hostname or IP address of the SQL Server instance. Must be reachable from FlowRunner. |
| Port | No | TCP port (default `1433`). |
| Database | No* | Database name to connect to. |
| User | No* | SQL Server login name. |
| Password | No* | Password for the SQL Server login. |
| Encrypt Connection | No | Enable TLS encryption (default on). Required for Azure SQL Database. Applies to field-based configuration only. |
| Trust Server Certificate | No | Accept the server's TLS certificate without validation. Enable for self-signed certificates (local development, some on-premises installs). Applies to field-based configuration only. |
| Connection Timeout (seconds) | No | How long to wait when establishing a connection (default `15`). |

\* Required when no Connection String is provided.

> **Azure SQL Database:** keep **Encrypt Connection** enabled (`Encrypt=true` when using a connection string) — Azure requires encrypted connections. The server name looks like `yourserver.database.windows.net` (port 1433), and the ready-made ADO.NET connection string from the portal's "Connection strings" page can be pasted directly into the Connection String setting. On some older setups the login must use the `user@yourserver` form. Make sure the database's firewall allows connections from FlowRunner.

## Safety Notes

- All **values** are bound as named query parameters (`@p1, @p2, ...`) — never interpolated into SQL.
- **Identifiers** (table and column names) cannot be bound as parameters, so they are escaped with bracket quoting (`]` doubled) before being placed in SQL.
- Table names may be schema-qualified (`sales.Orders`); unqualified names default to the `dbo` schema.
- In `Where` condition objects: `null` values match `IS NULL`, array values match any element (`IN (...)`, with an empty array matching nothing), all other values use equality; conditions are combined with `AND`.
- **Update Rows** and **Delete Rows** require a non-empty `Where` object to prevent accidental full-table writes. Use Execute Query for intentional unconditional statements.
- **Insert Row**, **Insert Rows**, **Update Rows** and **Upsert Row** return rows via `OUTPUT INSERTED.*`, which SQL Server does not allow on tables with enabled triggers — use Execute Query with `OUTPUT ... INTO` for those tables.

## Agent Ideas

- Use Microsoft SQL Server "Execute Query" to pull the latest sales figures, then use **Google Sheets** "Add Rows" to append them to a reporting spreadsheet for stakeholders.
- Use **Google Sheets** "Get Rows" to read a batch of records and Microsoft SQL Server "Insert Rows" (or "Upsert Row") to sync them into a database table.
- After a Microsoft SQL Server "Select Rows" query surfaces records needing attention (e.g. overdue accounts), use **Gmail** "Send Message" or **Slack** "Send Message To Channel" to notify the responsible team.
