# Quick Base

FlowRunner integration for [Quick Base](https://www.quickbase.com/) using the Quick Base JSON REST API (`https://api.quickbase.com/v1`). Query, insert, update, and delete records, manage tables and fields, read app and report metadata, run reports, and download file attachments into FlowRunner storage.

## Authentication

This service authenticates with a **user token** and your **realm hostname**. Every request sends two headers:

- `Authorization: QB-USER-TOKEN <userToken>`
- `QB-Realm-Hostname: <realmHostname>`

### Configuration

| Config item | Required | Description |
| --- | --- | --- |
| **Realm Hostname** | Yes | The host part of your Quick Base URL, e.g. `yourcompany.quickbase.com`. |
| **User Token** | Yes | A Quick Base user token. Create one in Quick Base under **My Preferences → Manage user tokens → New user token**, then grant it access to the app(s) you want to use. |

## The field-ID (fid) model

This is the single most important thing to understand about the Quick Base API: **records are keyed by numeric field IDs (fids), not by field names.**

A record looks like this on the wire:

```json
{ "6": { "value": "Task A" }, "7": { "value": 100 } }
```

Here `6` and `7` are the fids. Every table also has built-in fields — most importantly **Record ID#** which is always **fid 3**.

Because of this you must know the fids of the fields you want to read or write:

- **Select** in *Query Records* is an array of fids, e.g. `["3","6","7"]`.
- **Data** in *Insert/Update Records* is an array of fid-keyed objects, e.g. `[{"6":{"value":"Task A"}}]`.
- **Where** clauses reference fids, e.g. `{6.CT.'urgent'}`.

To discover fids, use the **Get Fields Dictionary** — it lists every field with its **label** and maps it to its **fid** (the item value). *List Fields* returns the same information as raw metadata. On *Query Records* you can also enable **Map Field Labels** to get a `fieldLabels` map (fid → label) back alongside the fid-keyed data for readability.

## The Quick Base query language

The `where` parameter (used by *Query Records* and *Delete Records*) uses the Quick Base query syntax:

```
{fid.OPERATOR.'value'}
```

Combine multiple conditions with `AND` / `OR` (operators must be **uppercase**):

```
{6.CT.'urgent'}AND{7.GT.'100'}
```

Common operators:

| Operator | Meaning |
| --- | --- |
| `EX` / `XEX` | equals / does not equal |
| `CT` / `XCT` | contains / does not contain |
| `SW` / `XSW` | starts with / does not start with |
| `GT` / `GTE` / `LT` / `LTE` | greater / greater-or-equal / less / less-or-equal |
| `BF` / `OBF` | date before / on or before |
| `AF` / `OAF` | date after / on or after |
| `IR` / `XIR` | date in range / not in range |
| `HAS` / `XHAS` | user-list contains / does not contain a set of users |
| `TV` | compares underlying keys (relationship / user fields) |

Examples:

- Record whose Record ID# is 42: `{3.EX.'42'}`
- Delete every record in a table: `{3.GT.'0'}`

## Operations

**Records** — Query Records, Insert/Update Records (upsert via `mergeFieldId`, defaults to fid 3), Delete Records.

**Tables** — List Tables, Get Table, Create Table, Update Table, Delete Table.

**Fields** — List Fields, Get Field, Create Field (field-type dropdown mapped to API tokens), Delete Fields.

**Apps** — Get App. *Quick Base has no list-all-apps endpoint*, so you must supply the application ID (dbid); find it in the app URL after `/db/`.

**Reports** — List Reports, Run Report.

**Files** — Download File (decodes a File Attachment field's base64 contents and stores them in FlowRunner file storage, returning a URL).

## Dictionaries

Most operations take **Table ID** as a plain text field (with an inline hint pointing you to *List Tables* or the table URL) rather than a picker. Dictionaries are wired in only where a natural parent value exists to scope the choices:

- **Get App Tables Dictionary** — backs the **Table ID** picker on *Get Table*, *Update Table*, and *Delete Table*, scoped by the **App ID** entered alongside it.
- **Get Tables Dictionary** — lists the tables in an app (depends on App ID); an app-scoped alias of the above.
- **Get Fields Dictionary** — lists a table's fields as label → fid (depends on Table ID). It is not attached to a record parameter, but you can call it directly to resolve every fid you need for Select, Where, and Data.

## Finding IDs

- **App ID (dbid):** in the app URL, the segment after `/db/` (e.g. `https://yourcompany.quickbase.com/db/bqr5abcd1`).
- **Table ID (dbid):** in a table's URL, or via *List Tables*.
- **Field ID (fid):** via *List Fields* or the **Get Fields Dictionary**.

## Agent Ideas

- Use **Quick Base** "Query Records" to pull rows matching a `where` clause, then **Google Sheets** "Add Rows" to mirror the fid-keyed data (enable Map Field Labels first) into a reporting spreadsheet.
- After a **Quick Base** "Insert/Update Records" upsert flags an urgent item, use **Slack** "Send Message To Channel" to alert the team with the returned Record ID#.
- Use **Google Sheets** "Get Rows" to read new entries from an intake sheet, then **Quick Base** "Insert/Update Records" to upsert them into the matching table by their key fid.
- When **Quick Base** "Query Records" surfaces overdue records, use **Gmail** "Send Message" to email each owner a summary of the affected fields.
