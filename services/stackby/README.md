# Stackby FlowRunner Extension

Row-level CRUD integration for [Stackby](https://stackby.com), the spreadsheet-database that organizes data in Stacks (bases) made of tables and columns. Authenticates with an API key sent in the `api-key` request header.

## Ideal Use Cases

- Logging inbound records (leads, orders, form submissions) into a Stackby table
- Syncing rows between Stackby and other apps on a schedule or trigger
- Reading a row to check a status field and drive downstream automation
- Bulk-creating, updating, or deleting rows from an AI Agent workflow

## List of Actions

### Rows

- Create Rows
- Delete Rows
- Get Row
- List Rows
- Update Rows

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** (required) — your Stackby API key from **Account/Profile → API key** (or your workspace API key). Sent as the `api-key` request header. Base URL: `https://stackby.com/api/v1`.

## Notes

- **Stack ID** — the Stack (Stackby's equivalent of a base) is identified by the ID in its URL in the Stackby app; supply it as the **Stack ID** parameter.
- **Table Name** — tables are referenced by their **display name** exactly as shown in the Stackby UI (case-sensitive), not by an ID.
- **Row shape** — rows are returned as `{ "id": "<rowId>", "field": { "<Column Name>": <value>, ... } }`. When creating rows you pass field objects (column-name → value); when updating you pass `{ "id": "<rowId>", "field": { ... } }`.
- **Row-CRUD scope** — this service covers row operations only; **Stack ID** and **Table Name** are free-form text (no dropdown dictionaries) and there are no table/column/view management actions. **Get Row** uses the row-list endpoint's `rowIds[]` filter to fetch just the requested row.
- **Pagination** — **List Rows** returns up to 100 rows per request; use **Max Records** and **Offset** to page through larger tables. Create, Update, and Delete each accept up to 10 rows per request.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull records from a spreadsheet, then call **Stackby** "Create Rows" to sync each record into a Stackby table.
- When a **Google Sheets** "On New Row" trigger fires, use **Stackby** "Create Rows" to mirror the new record into a Stackby table for downstream reporting.
- Read a status field with **Stackby** "Get Row", and when it warrants action, use **Slack** "Send Message To Channel" to notify the team with the row details.
