# Coda FlowRunner Extension

Integrate [Coda](https://coda.io) docs, tables, rows, columns, formulas, controls, buttons, and pages with FlowRunner. Read and write structured data in your Coda docs directly from your flows. Authentication uses a Coda API token, sent as a Bearer token on every request (base URL `https://coda.io/apis/v1`).

## Ideal Use Cases

- Sync structured data between a Coda table and other systems (spreadsheets, CRMs, databases).
- Insert or upsert rows into a Coda table as records arrive from webhooks, forms, or other services.
- Read Coda rows, named formulas, or control values to drive downstream logic in a flow.
- Automate Coda docs by pressing buttons that run configured automations or push data.
- Generate new docs and pages, seeding them with rich text or HTML content.

## List of Actions

### Docs

- List Docs
- Get Doc
- Create Doc
- Delete Doc

### Tables

- List Tables
- Get Table

### Rows

- List Rows
- Get Row
- Insert or Upsert Rows
- Update Row
- Delete Row
- Delete Multiple Rows

### Columns

- List Columns
- Get Column

### Formulas & Controls

- List Formulas
- Get Formula
- List Controls
- Get Control

### Buttons

- Push Button

### Pages

- List Pages
- Get Page
- Create Page

## List of Triggers

This service does not define any triggers.

## Key Behaviors

### `useColumnNames` — readable row values

`List Rows` and `Get Row` return each row's cells as a clean `values` object. By default
(`Use Column Names = true`) the keys are the **column names** (e.g. `{"Status":"Done"}`), which is
convenient for reading and mapping in a flow. Set it to **false** to key by the stable **column ID**
(e.g. `{"c-status":"Done"}`) instead — recommended for durable automations, since column names can
change while IDs do not.

When writing rows (`Insert or Upsert Rows`, `Update Row`), you likewise provide a simple
`{column: value}` map. Keys may be either column IDs or column names; the service converts the map
into Coda's `cells` array format for you.

### Asynchronous mutations

Coda write operations — **Insert or Upsert Rows**, **Update Row**, **Delete Row**,
**Delete Multiple Rows**, **Push Button**, and **Create Page** — are **asynchronous**. Coda accepts
the request and returns a `requestId` (and, for inserts, the new row IDs) immediately, but the
change may take a moment to be applied and become queryable. If a subsequent step reads data that a
mutation just wrote, allow a short delay or poll until the data appears.

### Pagination

List operations return `nextPageToken` (and `nextPageLink`) when more results are available. Pass
`nextPageToken` back as the **Page Token** parameter to fetch the next page.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull records from a spreadsheet, then call **Coda** "Insert or Upsert Rows" (with key columns) to sync each record into a Coda table without creating duplicates.
- Read a status field with **Coda** "Get Row", and when it changes, use **Slack** "Send Message To Channel" to notify the team with a link to the doc.
- Use **Coda** "List Rows" to fetch tracked items, then call **Notion** "Create Database Item" for each row to mirror the Coda table into a Notion database.
