# Azure Table Storage FlowRunner Extension

FlowRunner integration for [Azure Table Storage](https://learn.microsoft.com/en-us/rest/api/storageservices/table-service-rest-api), the NoSQL key/attribute store in Azure Storage. Manage tables and entities — keyed by a PartitionKey + RowKey pair — directly from your flows, with OData `$filter` queries and replace / merge / insert-or-* upsert semantics. Authenticates against the Table service REST API using hand-rolled SharedKeyLite HMAC-SHA256 signing (account name + account key), with no external dependencies.

## Ideal Use Cases

- Persisting high-volume, schemaless records (logs, telemetry, user profiles, IoT readings) in a low-cost NoSQL store
- Looking up or filtering entities by PartitionKey/RowKey or custom properties with OData `$filter` and `$select`
- Idempotent writes from automations using insert-or-replace / insert-or-merge upserts
- Managing table lifecycle (create, list, query, delete) as part of a data pipeline

## List of Actions

### Tables

- Create Table
- Delete Table
- List Tables
- Query Tables

### Entities

- Delete Entity
- Get Entity
- Insert Entity
- Insert-Or-Merge Entity
- Insert-Or-Replace Entity
- Merge Entity
- Query Entities
- Update Entity (Replace)

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

Authenticates with **SharedKeyLite** using your storage account name and account key. Signing is performed locally with Node's built-in `crypto` (HMAC-SHA256) — no external dependencies, and the account key never leaves the runtime.

| Item | Description |
| --- | --- |
| **Account Name** (required) | Your Azure Storage account name, e.g. `mystorageacct`. The endpoint is `https://{accountName}.table.core.windows.net`. |
| **Account Key** (required) | The base64 access key from Azure Portal → Storage account → Access keys → key1. |

## Notes

- **Data model**: every entity is uniquely identified by a **PartitionKey** + **RowKey** pair; other properties are schemaless. With `odata=nometadata`, values are typed automatically (string, number, boolean inferred). Force an EDM type by adding a companion property, e.g. `"NumberOfOrders@odata.type": "Edm.Int64"`.
- **Replace vs merge**: *Replace* (Update Entity, Insert-Or-Replace) writes the whole entity — omitted properties are removed. *Merge* (Merge Entity, Insert-Or-Merge) only touches supplied properties and retains the rest. The Insert-Or-* variants also insert when the entity does not yet exist.
- **`$filter`**: OData syntax with single-quoted string literals and `eq`/`ne`/`gt`/`ge`/`lt`/`le` combined via `and`/`or`/`not`, e.g. `PartitionKey eq 'us' and Age gt 30`.
- **Pagination**: at most 1000 rows per page. Tables return a `nextTableName` continuation token; entities return `nextPartitionKey` + `nextRowKey`. A `null` token means no further pages.
- **Auth is hand-rolled** against the Azure spec — confirm it with a live smoke test against a real storage account before production use.

## Agent Ideas

- Use **Azure Table Storage** "Query Entities" with a `$filter` to pull unprocessed records, then for each call **Slack** "Send Message To Channel" to alert the team and **Azure Table Storage** "Merge Entity" to mark the record as handled.
- When a **Google Sheets** "On New Row" trigger fires, call **Azure Table Storage** "Insert-Or-Replace Entity" to sync the row idempotently into a table keyed by PartitionKey + RowKey.
- On a **Google Calendar** "On Event Ended" trigger, use **Azure Table Storage** "Insert Entity" to append the meeting details as a durable audit record.
