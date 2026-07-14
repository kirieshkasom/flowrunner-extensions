# Google BigQuery FlowRunner Extension

FlowRunner integration for [Google BigQuery](https://cloud.google.com/bigquery), Google Cloud's serverless data warehouse. Run GoogleSQL queries with named parameters, stream rows into tables, read table data without query cost, and manage datasets and tables. Query results are automatically converted from BigQuery's wire format into plain JSON row objects keyed by column name, with typed numbers and booleans and ISO 8601 timestamps. Authentication is self-contained: the service signs a service-account JWT and exchanges it for a Google Cloud access token, with no SDK, no OAuth consent screen, and zero npm dependencies.

## Ideal Use Cases

- Run analytical SQL queries and use the resulting rows directly in flow logic
- Parameterize queries safely with `@name` placeholders instead of string concatenation
- Stream events, leads, or metrics from other services into a BigQuery table in near real time
- Page through large result sets or long-running queries with job-based result retrieval
- Read table contents without incurring query cost for exports and syncs
- Provision datasets and tables (including nested Record columns) as part of an automation

## List of Actions

### Queries

- Run Query
- Get Query Results

### Table Data

- Insert Rows
- List Rows

### Datasets

- List Datasets
- Create Dataset
- Delete Dataset

### Tables

- List Tables
- Get Table
- Create Table
- Delete Table

## List of Triggers

This service does not define any triggers.

## Configuration

- **Service Account Key (JSON)** (required): Full JSON key file of a service account with the **BigQuery Job User** (`roles/bigquery.jobUser`) and **BigQuery Data Editor** (`roles/bigquery.dataEditor`) roles. Paste the entire contents of the downloaded file.
- **Project ID** (optional): Google Cloud project to bill queries against. Defaults to `project_id` from the key file.
- **Location** (optional): Dataset location such as `US`, `EU`, or a region like `us-central1`. Needed when querying datasets stored outside the US multi-region; also used as the default location for new datasets.

### Creating a service account key

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select (or create) the project you want to use.
2. Make sure the **BigQuery API** is enabled: APIs & Services > Library > search "BigQuery API" > Enable (it is enabled by default in most projects).
3. Go to **IAM & Admin > Service Accounts** and click **Create Service Account**.
4. Give it a name (e.g. `flowrunner-bigquery`), then grant it the roles **BigQuery Job User** (`roles/bigquery.jobUser`) and **BigQuery Data Editor** (`roles/bigquery.dataEditor`). Use **BigQuery Data Viewer** instead of Data Editor if the flows only read data.
5. Open the created service account, go to the **Keys** tab, and click **Add Key > Create new key > JSON**. A `.json` file downloads.
6. Paste the **entire contents** of that file into the *Service Account Key (JSON)* config item.

The service builds an RS256-signed JWT from the key, exchanges it at `https://oauth2.googleapis.com/token` for a one-hour access token, and caches the token in memory until shortly before expiry.

## Notes

- **Row conversion**: BigQuery's REST API returns rows as `{ "f": [{ "v": ... }] }` with every value as a string. This service converts them into plain objects keyed by column name: `INT64` → number (kept as a string only when it exceeds JavaScript's safe integer range), `FLOAT64` → number, `BOOL` → boolean, `TIMESTAMP` → ISO 8601 string, `REPEATED` columns → arrays, and `RECORD` columns → nested objects. `NUMERIC`/`BIGNUMERIC` values stay as strings to preserve precision.
- **Named query parameters**: reference values in SQL as `@name` (e.g. `WHERE age > @minAge`) and supply them in the *Query Parameters* object of **Run Query** (`{"minAge": 21}`). Types are inferred: whole numbers → `INT64`, other numbers → `FLOAT64`, booleans → `BOOL`, everything else → `STRING`.
- **Long-running queries**: **Run Query** waits up to *Timeout Ms* (default 30 s). If the query has not finished, it returns `jobComplete: false` with a `jobId`; pass that ID to **Get Query Results** to fetch the rows once the job completes. The same action also pages through large result sets via `pageToken`.
- **Locations**: BigQuery jobs run in the location of the datasets they touch. If your datasets live outside the US multi-region (e.g. `EU`), set the *Location* config item, or queries and result lookups may fail with "job not found".
- **Streaming inserts**: rows added with **Insert Rows** are queryable within seconds but can take up to 90 minutes to become available for copy/export operations, and cannot be deleted with time-travel rollback. Partial failures are reported per row in `insertErrors`.
- **Destructive actions**: **Delete Dataset** (with *Delete Contents* enabled) and **Delete Table** permanently remove data and cannot be undone from this service.

## Agent Ideas

- Call **Stripe** "List Payment Intents" on a schedule, then **Google BigQuery** "Insert Rows" to stream payment records into an `analytics.payments` table for warehouse-side revenue reporting.
- Run **Google BigQuery** "Run Query" on a schedule to compute daily KPIs, then **Slack** "Send Message To Channel" to post the numbers to a metrics channel.
- Call **Google BigQuery** "Run Query" with a named `@customerId` parameter to pull a customer's usage history, then **Google Vertex AI** "Generate Content" to draft a personalized renewal email.
- Use **Google Sheets** "On New Row" trigger and **Google BigQuery** "Insert Rows" to mirror a shared spreadsheet into a governed warehouse table.
- Run **Google BigQuery** "List Rows" page by page to export a table, then **Airtable** "Create Record" for each row to hydrate an operational base.
