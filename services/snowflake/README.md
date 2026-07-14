# Snowflake FlowRunner Extension

FlowRunner integration for [Snowflake](https://www.snowflake.com/), the cloud data platform. Talks directly to the [Snowflake SQL API v2](https://docs.snowflake.com/en/developer-guide/sql-api/intro) over HTTPS — no drivers and no npm dependencies. Authentication uses a **programmatic access token (PAT)**; results are automatically converted from Snowflake's columnar wire format into plain row objects keyed by column name.

## Ideal Use Cases

- Run parameterized SQL queries against a Snowflake warehouse from within a workflow.
- Load records produced by other workflow steps into Snowflake tables (INSERT/MERGE via Execute SQL).
- Pull analytics results out of Snowflake and feed them to spreadsheets, CRMs, or messaging tools.
- Discover databases, schemas, tables, and table structures before reading or writing.
- Kick off long-running statements, then poll for their results or cancel them.

## List of Actions

### SQL

- **Execute SQL** — run any SQL statement (SELECT, INSERT, UPDATE, DELETE, MERGE, DDL, CALL, SHOW) with `?` placeholders bound via the Parameters array; returns rows as plain objects plus the total row count and statement handle (120s execution limit).
- **Get Statement Results** — retrieve the status/results of a statement by handle; supports fetching individual partitions of large result sets.
- **Cancel Statement** — cancel a running statement by handle.

### Metadata

- **List Databases** — `SHOW DATABASES` visible to the configured role.
- **List Schemas** — `SHOW SCHEMAS IN DATABASE <db>`.
- **List Tables** — `SHOW TABLES IN SCHEMA <db>.<schema>` with row counts and sizes.
- **List Warehouses** — `SHOW WAREHOUSES` with state and size.
- **Get Table Schema** — `DESCRIBE TABLE <db>.<schema>.<table>`: column names, types, nullability, defaults, key flags.

## List of Triggers

This service does not define any triggers.

## Configuration

| Setting | Required | Description |
| --- | --- | --- |
| Account Identifier | Yes | The part of your account URL before `.snowflakecomputing.com`, e.g. `myorg-myaccount` or `xy12345.us-east-1`. |
| Programmatic Access Token | Yes | A Snowflake PAT (see below). Password authentication is not supported by the SQL API. |
| Default Database | No | Database used when an operation doesn't specify one. Case-sensitive. |
| Default Schema | No | Schema used when an operation doesn't specify one (e.g. `PUBLIC`). |
| Default Warehouse | No | Virtual warehouse providing compute (e.g. `COMPUTE_WH`). Required for queries that need compute. |
| Default Role | No | Role for statements; falls back to the token user's default role. |

Per-operation `database` / `schema` / `warehouse` / `role` parameters override these defaults. Context values are case-sensitive and must match the names shown by the corresponding `SHOW` command (typically uppercase).

### Finding Your Account Identifier

In Snowsight, open the account menu (bottom-left) → **Account** → **View account details**. The **Account/Server URL** looks like `https://myorg-myaccount.snowflakecomputing.com`; the account identifier is everything before `.snowflakecomputing.com` (`myorg-myaccount`). Legacy account locators like `xy12345.us-east-1` also work. Pasting the full URL into the config field works too — the service strips the protocol and suffix automatically (underscores in locators are converted to hyphens, as required for hostnames).

### Creating a Programmatic Access Token

1. Sign in to **Snowsight**.
2. Click your user profile (bottom-left) → **Settings** → **Authentication**.
3. Under **Programmatic access tokens**, click **Generate new token**.
4. Give the token a name, choose the role it should be restricted to (or allow any of your roles), and set an expiration.
5. Copy the token value immediately — it is shown only once — and paste it into the service's **Programmatic Access Token** field.

Notes:

- The user needs a role with access to the target database/schema/warehouse.
- Depending on your account's authentication policy, Snowflake may require a network policy to be in place before PATs can be used; if token requests are rejected with a network policy error, ask an admin to configure one.
- The service sends the token as `Authorization: Bearer <token>` with `X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN`.

## Query Results and Long-Running Statements

- The SQL API returns results as column metadata plus arrays of string values; this service converts every result into plain row objects keyed by column name, coercing numbers and booleans to native JSON types (very large `NUMBER(38,0)` values that would lose precision remain strings).
- Statements are submitted synchronously. If a statement does not finish within the API's synchronous window (about 45 seconds), **Execute SQL** returns `{ "inProgress": true, "statementHandle": "..." }` — poll **Get Statement Results** with that handle until the rows arrive, or use **Cancel Statement** to stop it.
- Large result sets are split into **partitions**. Execute SQL returns partition 0 along with a partition list; fetch the remaining partitions with **Get Statement Results** and the `partition` parameter.
- Bind values with `?` placeholders and the Parameters array (types are inferred: TEXT, FIXED, REAL, BOOLEAN). Binding is not supported in multi-statement requests.

## Agent Ideas

- Use **Snowflake** "Execute SQL" to run an analytics query, then push each returned row into a spreadsheet with **Google Sheets** "Add Rows" for reporting.
- Read new records with **Airtable** "Get Records", then load them into a warehouse table via **Snowflake** "Execute SQL" (INSERT/MERGE) to keep your data warehouse in sync.
- After a **Snowflake** "Execute SQL" query surfaces an anomaly, post a summary to a channel using **Slack** "Send Message To Channel" to alert the team.
- Export data with **BigQuery** "Run Query", then stage it into Snowflake with **Snowflake** "Execute SQL" for cross-cloud analytics.
