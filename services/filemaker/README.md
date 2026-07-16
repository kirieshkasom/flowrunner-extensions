# FileMaker FlowRunner Extension

Integrate FlowRunner with a database hosted by [FileMaker Server or FileMaker Cloud](https://www.claris.com/filemaker/) through the FileMaker Data API. Read, create, edit, find, and delete records, run scripts, inspect layout metadata, and set global fields. Records are always accessed through a layout using FileMaker's `fieldData` model, and the service authenticates with a session-token login flow (host/database/username/password → Bearer token).

## Ideal Use Cases

- Create, read, edit, delete, and duplicate records in a hosted FileMaker solution as part of an automated workflow.
- Run structured `_find` queries to pull matching found sets into downstream steps.
- Trigger FileMaker scripts and capture their result and error code.
- Discover available layouts, scripts, and layout field metadata before building record operations.
- Set session-scoped global fields to pass context into FileMaker scripts and calculations.
- Perform a lightweight connection check against a FileMaker Server before running heavier automations.

## List of Actions

### Records
- Create Record
- Delete Record
- Duplicate Record
- Edit Record
- Get Record
- Get Records

### Find
- Find Records

### Scripts
- List Scripts
- Run Script

### Metadata
- Get Layout Metadata
- Get Product Info
- List Layouts

### Globals
- Set Global Fields

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses the FileMaker Data API's **session-token login flow** rather than OAuth:

1. On the first operation of each execution, the service calls `POST /fmi/data/vLatest/databases/{database}/sessions` with an HTTP **Basic** `Authorization` header built from your `username` and `password` (and an empty JSON body).
2. FileMaker returns an access token in the response body (`response.token`) and the `X-FM-Data-Access-Token` header.
3. That token is cached in memory and sent as `Authorization: Bearer {token}` on every subsequent call.

If a call returns HTTP `401`, the service re-authenticates once and retries automatically.

### Configuration

| Item | Description |
| --- | --- |
| **Host** | Your FileMaker Server host, e.g. `fms.example.com` — no protocol or path. |
| **Database** | The hosted database/solution name. |
| **Username** | A FileMaker account with the Data API (`fmrest`) extended privilege. |
| **Password** | The account password. |

The base URL for all data calls is `https://{host}/fmi/data/vLatest/databases/{database}`. `vLatest` always resolves to the newest Data API version the server supports.

## Notes

### Layout-based access

FileMaker records are **not** accessed by table directly — every record operation goes through a **layout**. The layout determines which fields, portals, and related data are visible and writable. Pick the layout that exposes the fields you need; the layout picker on record operations is populated from the hosted database's layouts, and **Get Layout Metadata** reveals the field names for building `fieldData`.

### The `fieldData` model

Record contents are represented as a `fieldData` object keyed by field name:

```json
{ "Name": "Widget", "Price": 9.99, "Status": "Active" }
```

- **Create Record** and **Edit Record** accept `fieldData`; on edit, supply only the fields you want to change.
- **Edit Record** optionally accepts a `modId` for optimistic locking — the edit is rejected if the record changed since that modId.
- Reads return each record as `{ fieldData, portalData, recordId, modId }`. The `recordId` is FileMaker's internal record ID (used by Get/Edit/Delete/Duplicate), distinct from any field value.

### Finding records

**Find Records** posts a `query` array to `/_find`. Each object maps field names to search criteria; multiple objects are OR-ed together, and `"omit": "true"` excludes a request's matches:

```json
[
  { "Status": "Active" },
  { "Status": "Discontinued", "omit": "true" }
]
```

FileMaker find operators (`==`, `*`, `>`, ranges, etc.) can appear inside the values. Sorting, `offset`, and `limit` are supported.

### The `messages` envelope

Every FileMaker Data API response is wrapped as:

```json
{ "response": { ... }, "messages": [ { "code": "0", "message": "OK" } ] }
```

A message `code` of `"0"` means success. This service inspects `messages` on every call: any non-`"0"` code is thrown as an error (with the message and code), even when the HTTP status is `2xx`. Successful operations return the inner `response` payload.

## Agent Ideas

- Use **Airtable** "Get Records" to pull rows from a base, then call **FileMaker** "Create Record" to sync each row into the matching FileMaker layout.
- When a **FileMaker** "Find Records" query returns a found set, use **Google Sheets** "Add Rows" to export the matching `fieldData` into a spreadsheet for reporting.
- After a **FileMaker** "Edit Record" or "Run Script" completes, use **Slack** "Send Message To Channel" to notify the team with the updated record's `recordId` and `modId`.
