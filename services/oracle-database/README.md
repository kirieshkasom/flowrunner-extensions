# Oracle Database FlowRunner Extension

FlowRunner integration for [Oracle Database](https://www.oracle.com/database/). Connects directly to an Oracle database over TCP using the official [`node-oracledb`](https://node-oracledb.readthedocs.io/) driver in **Thin mode** — a pure-JavaScript driver that needs **no Oracle Instant Client** and no native compilation. It exposes both raw SQL / PL/SQL execution and convenient no-SQL row operations. It uses a **connect-per-call** model: every operation opens a short-lived connection, runs its statement, and always closes the connection when the call finishes — no connections or pools are cached between invocations.

## Ideal Use Cases

- Run parameterized SQL queries against an application or analytics database from within a workflow.
- Read, insert, update, or delete rows without writing SQL.
- Execute anonymous PL/SQL blocks (call procedures/functions, capture OUT binds).
- Sync records between Oracle and other apps (spreadsheets, CRMs, messaging tools).
- Discover a schema's structure by listing tables and describing table columns.

## List of Actions

### SQL

- **Execute Query** — run a SELECT statement using `:name` or `:1, :2` bind placeholders; returns rows (as objects), the row count, and column names (120s execution limit, optional Max Rows cap).
- **Execute Statement** — run an INSERT/UPDATE/DELETE/DDL statement with autoCommit; returns `rowsAffected` (120s execution limit).
- **Execute PL/SQL Block** — run an anonymous `BEGIN ... END;` block and capture OUT bind values (120s execution limit).

### Rows

- **Select Rows** — read rows with column selection, a raw bound WHERE clause, ordering, and a `FETCH FIRST n ROWS ONLY` limit.
- **Insert Row** — insert one row from a JSON object; values bound as parameters.
- **Update Rows** — update rows matching a non-empty raw WHERE clause; returns rows affected.
- **Delete Rows** — delete rows matching a non-empty raw WHERE clause; returns rows affected.

### Schema

- **Describe Table** — column name, data type, nullability, and length from `USER_TAB_COLUMNS`.
- **List Tables** — all tables owned by the connected user from `USER_TABLES`.

## List of Triggers

This service does not define any triggers.

## Driver & Connection Model

The service uses `node-oracledb` in **Thin mode**, which is the default in version 6.x. Thin mode is a pure-JavaScript implementation that connects over TCP just like the PostgreSQL/MySQL drivers — it does **not** require the Oracle Instant Client, `LD_LIBRARY_PATH` setup, or `initOracleClient()`. `npm install oracledb` installs with no native compilation.

Every operation opens a short-lived connection, runs its statement, and always closes the connection when the call finishes (success or failure). No connections or pools are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call. Statements are bounded by a 120-second execution timeout.

If the database host resolves to an IPv6-only address (common with some managed/Autonomous endpoints) and the environment has no IPv6 route, connections fail with `ENETUNREACH` — use an IPv4-compatible hostname or endpoint in that case.

## Configuration

Connect with either a single **Connect String** or the individual Host / Port / Service Name fields. When Connect String is set it takes precedence and the individual fields are ignored. Provide the **User** and **Password** in all cases.

| Setting | Required | Description |
| --- | --- | --- |
| Connect String | No* | Oracle Easy Connect string `host:port/service_name` (e.g. `dbhost:1521/ORCLPDB1`), **or** a full Oracle Autonomous Database TLS connect string. Takes precedence over the fields below. Thin mode supports the Autonomous TLS connect string directly, with no wallet. |
| Host | No* | Hostname or IP address of the database server. Used only when no Connect String is provided. |
| Port | No | TCP listener port (default `1521`). |
| Service Name | No* | The Oracle service name (Easy Connect is `host:port/service_name`). Used only when no Connect String is provided. |
| User | Yes | Database username. |
| Password | Yes | Password for the database user. |

\* Provide either a Connect String, or both Host and Service Name.

> **Oracle Autonomous Database:** copy the TLS connect string (the long `(description=(retry_count=...)...)` descriptor, or the TLS Easy Connect equivalent) from the database's connection details and paste it into **Connect String**. In Thin mode no wallet is required for TLS connections.

## Identifiers & Case Sensitivity

Oracle folds unquoted identifiers to **UPPERCASE**, so table and column names are stored uppercase in the data dictionary (`USER_TABLES`, `USER_TAB_COLUMNS`) unless they were created with quotes. Consequently:

- **List Tables** and **Describe Table** return names in their stored (usually UPPERCASE) form.
- When a Data object or Order By references a column, its key must match the stored name — usually UPPERCASE (e.g. `{"EMAIL":"ada@example.com"}`).
- **Describe Table** and the column dictionary match the table name case-insensitively via `UPPER(...)`.

## Bind Parameters

Oracle uses `:name` (named) or `:1, :2` (positional) bind placeholders. Supply values via the **Binds** / **Where Binds** parameter as either a JSON object (named binds) or a JSON array (positional binds). For PL/SQL OUT/IN OUT binds, describe each bind with a direction object, e.g. `{"result":{"dir":"out","type":"number"}}` (directions: `in`/`out`/`inout`; types: `string`/`number`/`date`).

## Safety Notes

- All **values** are bound as parameters (`:name` / `:1`) — never interpolated into SQL.
- **Identifiers** (table and column names) cannot be bound as parameters, so table/column names supplied to the no-SQL row operations are escaped with double-quote doubling.
- The **Where Clause** on Select/Update/Delete Rows is raw SQL and is treated as **trusted input** — bind its values with Where Binds; never concatenate untrusted user input into it.
- **Update Rows** and **Delete Rows** require a non-empty Where Clause to prevent accidental full-table writes. Use Execute Statement for intentional unconditional statements.

## Agent Ideas

- Use Oracle "Execute Query" to pull the latest figures, then use **Google Sheets** "Add Rows" to append them to a reporting spreadsheet.
- Use **Google Sheets** "Get Rows" to read a batch of records and Oracle "Insert Row" to sync them into a table.
- After an Oracle "Select Rows" query surfaces records needing attention, use **Gmail** "Send Message" or **Slack** "Send Message To Channel" to notify the responsible team.

> **Note:** This service is driver-based (like the PostgreSQL and MySQL extensions) rather than HTTP-based, and should be verified with a live FlowRunner smoke test against a reachable Oracle database.
