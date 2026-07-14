# TimescaleDB FlowRunner Extension

FlowRunner integration for [TimescaleDB](https://www.timescale.com/) — the time-series database built as a PostgreSQL extension. TimescaleDB is fully wire-compatible with PostgreSQL, so this service connects directly to a TimescaleDB server (self-managed or **TimescaleDB Cloud / Tiger Cloud**) over TCP using the official [`pg`](https://node-postgres.com/) driver. On top of standard SQL and no-SQL row operations, it exposes TimescaleDB-specific actions: hypertables, `time_bucket` aggregation, columnar compression, continuous aggregates, and chunk-based retention.

It uses a **connect-per-call** model: every operation opens a short-lived `pg.Client`, runs its query, and always closes the connection when the call finishes — no connections or pools are cached between invocations.

## Key Concepts

- **Hypertable** — a regular PostgreSQL table that TimescaleDB automatically partitions by time (and optionally by other dimensions) into physical **chunks**. You read and write it like any table; the partitioning is transparent. Create one with **Create Hypertable** on a table that has a time column.
- **Chunk** — one physical time-range partition of a hypertable's data. Dropping old chunks (**Drop Chunks**) is the fast, retention-friendly alternative to deleting rows.
- **`time_bucket`** — TimescaleDB's function for grouping rows into fixed time intervals (e.g. hourly, daily). **Time Bucket Query** builds a `SELECT time_bucket(...) ... GROUP BY bucket` for you.
- **Compression** — native columnar compression for older chunks; **Enable Compression** turns it on and can schedule an automatic policy.
- **Continuous aggregate** — a materialized view (`WITH (timescaledb.continuous)`) that incrementally maintains a `time_bucket` rollup so summaries stay fast; created with **Create Continuous Aggregate**.

Interval parameters throughout are plain SQL interval strings such as `1 hour`, `15 minutes`, `7 days`, or `1 month`.

## Ideal Use Cases

- Ingest sensor / metrics / event streams into a hypertable (single-row or batch).
- Roll up raw time-series into hourly or daily summaries with `time_bucket`, or with continuous aggregates for always-fast reads.
- Enforce data retention by dropping chunks older than a threshold.
- Enable compression on historical data to reduce storage.
- Run parameterized SQL and no-SQL row operations against any PostgreSQL/TimescaleDB table.

## List of Actions

### SQL

- **Execute Query** — run any SQL statement (including TimescaleDB functions) using `$1, $2, ...` placeholders bound via the Parameters array; returns rows, affected count, and field metadata (120s execution limit).

### Rows

- **Select Rows** — read rows with column selection, equality filters, ordering, limit and offset.
- **Insert Row** — insert one row from a JSON object; returns the inserted row (`RETURNING *`).
- **Insert Rows** — bulk-insert an array of row objects in a single statement (great for batch ingest).
- **Update Rows** — update rows matching a non-empty Where object; returns the updated rows.
- **Delete Rows** — delete rows matching a non-empty Where object; returns the deleted count.
- **Upsert Row** — `INSERT ... ON CONFLICT ... DO UPDATE` keyed by the given conflict columns.

### Schema

- **Get Table Schema** — column names, types, nullability, defaults, and positions from `information_schema.columns`.
- **List Tables** — all tables and views in user schemas (system schemas excluded).

### Hypertables

- **Create Hypertable** — convert an existing table into a time-partitioned hypertable (optional chunk time interval; optional migration of existing data).
- **List Hypertables** — all hypertables with dimensions, chunk counts, and compression status (`timescaledb_information.hypertables`).
- **Get Hypertable Chunks** — the chunks of a hypertable with their time ranges and compression state (`timescaledb_information.chunks`).

### Time-Series Analytics

- **Time Bucket Query** — bucket rows into fixed time intervals and compute aggregates per bucket via `time_bucket`.

### Compression & Retention

- **Enable Compression** — turn on columnar compression (optional segment-by / order-by) and optionally schedule an automatic compression policy.
- **Create Continuous Aggregate** — create a `time_bucket` materialized view maintained incrementally (`WITH (timescaledb.continuous)`).
- **Show Chunks** — list a hypertable's chunks, optionally only those older than an interval (preview before dropping).
- **Drop Chunks** — permanently drop chunks older than an interval for efficient retention.

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation opens a short-lived `pg.Client`, runs its query, and always closes the connection when the call finishes (success or failure). No connections or pools are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call.

- Connection establishment is bounded by the configurable **Connection Timeout** (default 10 seconds).
- Statements are bounded by a 120-second `statement_timeout`.

## Configuration

Connect with either a single connection string (the copy-paste URI Tiger Cloud, RDS, self-hosted, etc. provide) or individual fields. When Connection String is set it takes precedence and the individual fields are ignored.

| Setting | Required | Description |
| --- | --- | --- |
| Connection String | No | Full PostgreSQL URI, e.g. `postgresql://tsdbadmin:password@abc123.tsdb.cloud.timescale.com:30000/tsdb`. TimescaleDB Cloud / Tiger Cloud provides one in the service dashboard. Takes precedence over the fields below. Special characters in the password must be URL-encoded. |
| Host | No* | Hostname or IP address of the server (e.g. `abc123.tsdb.cloud.timescale.com`). Must be reachable from FlowRunner. |
| Port | No | TCP port (default `5432`; Tiger Cloud often uses a custom port such as `30000`). |
| Database | No* | Database name (Tiger Cloud defaults to `tsdb`). |
| User | No* | Database user/role (Tiger Cloud defaults to `tsdbadmin`). |
| Password | No* | Password for the database user. |
| Use SSL/TLS | No | Enable TLS-encrypted connections. Required by most managed databases, including TimescaleDB Cloud / Tiger Cloud and AWS RDS. Certificate verification is relaxed to support managed providers' default certificates. With a connection string, enabling this adds TLS on top of the URI; when off, any `sslmode` in the URI still applies. |
| Connection Timeout (seconds) | No | How long to wait when establishing a connection (default `10`). |

\* Required when no Connection String is provided.

> **Tiger Cloud:** copy the connection string from your service's **Connect** panel and paste it into Connection String, then enable **Use SSL/TLS**.
>
> **IPv6 note:** if a host resolves to an IPv6-only address and the environment has no IPv6 route, connections fail with `ENETUNREACH`. Use an IPv4-compatible endpoint — for Supabase-hosted Postgres, use the "Session pooler" connection string rather than the direct `db.<project-ref>.supabase.co` address.

## Safety Notes

- All **values** are bound as query parameters (`$1, $2, ...`) — never interpolated into SQL.
- **Identifiers** (table and column names) cannot be bound as parameters, so they are escaped with double-quote doubling before being placed in SQL.
- **Interval** inputs (e.g. `7 days`) are validated to a safe interval-like character set before being placed into `INTERVAL '...'` positions in DDL and policy/retention functions, which cannot be parameterized.
- The **Aggregations**, **Where Clause** (Time Bucket Query), and **Select Body** (Create Continuous Aggregate) parameters accept raw SQL expressions and are inserted verbatim — supply trusted values only.
- Table names may be schema-qualified (`analytics.metrics`); unqualified names default to the `public` schema.
- **Update Rows** and **Delete Rows** require a non-empty `Where` object; **Drop Chunks** requires an `Older Than` interval — all to prevent accidental full-table/full-hypertable data loss.

## Agent Ideas

- Use TimescaleDB "Time Bucket Query" to compute hourly averages from a metrics hypertable, then **Google Sheets** "Add Rows" to publish the rollup to a dashboard sheet.
- On a schedule, use TimescaleDB "Drop Chunks" to enforce a 90-day retention policy on raw event data, then **Slack** "Send Message To Channel" to report how many chunks were dropped.
- Ingest API or webhook payloads with TimescaleDB "Insert Rows" into a hypertable, and use "Enable Compression" once to keep historical storage small.
