# Databricks FlowRunner Extension

FlowRunner service for the [Databricks REST API](https://docs.databricks.com/api/workspace/introduction). Run SQL on a warehouse, orchestrate jobs, manage clusters, browse Unity Catalog, and inspect DBFS/Workspace paths from your flows. Authenticates with your workspace URL and a personal access token sent as a Bearer token.

## Ideal Use Cases

- Run parameterized SQL queries against a SQL warehouse and use the results inline in a flow, or poll long-running statements to completion.
- Trigger existing Databricks jobs on demand with parameter overrides and track each run to a terminal state.
- Start, stop, and inspect SQL warehouses and clusters to control compute cost around scheduled workloads.
- Discover data assets by browsing Unity Catalog catalogs, schemas, and tables, plus DBFS and workspace paths.

## List of Actions

### SQL

- Execute SQL Statement
- Get Statement Result
- Cancel Statement
- List SQL Warehouses
- Get SQL Warehouse
- Start SQL Warehouse
- Stop SQL Warehouse

### Jobs

- List Jobs
- Get Job
- Run Job Now
- List Job Runs
- Get Run
- Get Run Output
- Cancel Run

### Clusters

- List Clusters
- Get Cluster
- Start Cluster
- Terminate Cluster

### Unity Catalog

- List Catalogs
- List Schemas
- List Tables

### Files

- List DBFS Path
- List Workspace Path

### Account

- Get Current User

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses a Databricks **personal access token (PAT)** sent as a Bearer token (`Authorization: Bearer <apiToken>`).

| Item | Required | Description |
| --- | --- | --- |
| **Workspace URL** | Yes | Your workspace URL, e.g. `https://dbc-abc123.cloud.databricks.com`. Any trailing slash is stripped automatically. All API calls are made against this host. |
| **API Token** | Yes | A personal access token. Generate one in **Databricks → Settings → Developer → Access tokens → Generate new token**. |

Use **Get Current User** as a quick connection check after configuring the service.

## SQL Warehouse Execution Flow

SQL runs on a **SQL warehouse**, so every **Execute SQL Statement** call needs a `warehouse_id` (pick one via the Warehouses dropdown, or discover it with **List SQL Warehouses**). Start a stopped warehouse first with **Start SQL Warehouse**.

Execution can be synchronous or asynchronous, controlled by **Wait Timeout**:

- **Synchronous (Wait Timeout 5–50s):** the call blocks up to the timeout. If the statement finishes in time, the response contains the final `status.state` of `SUCCEEDED` plus the `manifest` (column schema) and inline `result` data. Best for fast, interactive queries.
- **Asynchronous (Wait Timeout 0, or a statement still running at the timeout):** the response returns a `statement_id` with a `PENDING`/`RUNNING` status. Poll **Get Statement Result** with that `statement_id` until `status.state` reaches a terminal value (`SUCCEEDED`, `FAILED`, `CANCELED`, or `CLOSED`). Use **Cancel Statement** to abort a running statement.

Bind values safely with named parameters: reference them as `:name` in the statement and pass a **Parameters** array of `{ name, value, type }` objects (`type` defaults to `STRING`). Inline results are capped at 25 MiB — use the `EXTERNAL_LINKS` disposition for larger result sets.

## Notes

- Warehouse and cluster start/stop calls return immediately; the resource transitions state asynchronously, so poll **Get SQL Warehouse** / **Get Cluster** to confirm.
- Job and run IDs are numeric in the Databricks API; the service coerces string inputs to numbers where the API requires it.
- Errors surface the Databricks `message` / `error_code` and HTTP status.

## Agent Ideas

- Use Databricks **Execute SQL Statement** (with a wait timeout) to pull a metrics summary from a SQL warehouse, then post the results to a channel with **Slack** "Send Message To Channel".
- Run Databricks **Run Job Now** and poll **Get Run** until the job reaches a terminal state, then log the run outcome to a spreadsheet with **Google Sheets** "Add Row".
- Query aggregated results with Databricks **Execute SQL Statement**, then load them into an analytics table using **BigQuery** "Run Query" for downstream reporting.
