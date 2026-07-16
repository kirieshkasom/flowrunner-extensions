# Grist FlowRunner Extension

Integrate [Grist](https://www.getgrist.com/) documents with FlowRunner. Grist is a modern relational spreadsheet: documents contain tables, tables contain typed columns, and rows are addressed by a numeric row ID. This service exposes record CRUD (including upsert), table and column management, document and workspace discovery, and read-only SQL queries. Requests authenticate with `Authorization: Bearer <apiKey>` against `{baseUrl}/api`.

## Ideal Use Cases

- Keep a Grist table in sync with an external source using **Add or Update Records** (upsert) keyed on a unique column such as an email or external ID.
- Log or archive incoming events by appending rows with **Add Records**.
- Report on document data by running read-only `SELECT` queries with **Query with SQL**, joining and aggregating across tables.
- Provision structure on the fly by creating tables and columns before writing data.

## List of Actions

### Records
- Add Records
- Add or Update Records
- Delete Records
- List Records
- Update Records

### Tables
- Create Table
- List Tables
- Modify Table

### Columns
- Add Columns
- List Columns

### Documents & Workspaces
- Get Document
- List Documents
- List Workspaces

### SQL
- Query with SQL

### Attachments
- List Attachments

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Base URL** | No | Where your Grist instance lives. Defaults to `https://docs.getgrist.com` (the free hosted service). **Team sites** use `https://{team}.getgrist.com`. **Self-hosted** instances use your own domain. Do not include a trailing slash. |
| **API Key** | Yes | Your personal API key from Grist. Open your account menu, choose **Profile Settings**, and copy the value under **API Key**. |

### Finding a Document ID

A Grist document URL looks like `https://docs.getgrist.com/abc123XyZ/My-Doc`. The `abc123XyZ` segment is the **document ID** used throughout this service. You can also discover documents with the **List Documents** action or the built-in document picker.

## Notes

- **Record shape** — records are keyed by **column ID**: `{ "id": 1, "fields": { "Name": "Alice", "Status": "Open" } }`. `id` is the numeric row ID (used for updates and deletes); `fields` maps column IDs (not labels) to values.
- **Upsert** — **Add or Update Records** takes items carrying `require` (columns that identify a record) and `fields` (values to write). If a row matching every `require` column exists it is updated; otherwise a new row is created from `require` + `fields`. Optional **Do Not Add** / **Do Not Update** toggles restrict the operation to updates-only or adds-only, making it well suited to idempotent syncs.
- **SQL** — **Query with SQL** runs a read-only `SELECT` over the document. Grist exposes each table as a SQLite table named after its table ID, so you can join, aggregate, and filter with standard SQLite syntax. Only `SELECT` is permitted.
- A table's **ID is also its display name** in Grist; the two are the same string.
- **List Attachments** returns attachment metadata only; uploading attachments is not supported.

## Agent Ideas

- Use **Airtable** "Get Records" to pull a source dataset, then call **Grist** "Add or Update Records" to upsert each row into a Grist table keyed on a unique ID, keeping the two systems in sync.
- When a **Google Sheets** "On New Row" trigger fires, use **Grist** "Add Records" to mirror the new row into a Grist table for relational reporting.
- Run **Grist** "Query with SQL" to aggregate document data, then post the summary to a channel with **Slack** "Send Message To Channel".
