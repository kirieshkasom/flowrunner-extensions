# Azure Cosmos DB FlowRunner Extension

FlowRunner integration for Azure Cosmos DB using the Core (SQL) API over the REST interface. Manage databases and containers, and create, read, query, replace, upsert, and delete documents. Zero external dependencies — master-key HMAC signing uses only Node's built-in `crypto` module.

## Ideal Use Cases

- Persist and retrieve application state, events, or records in a globally distributed NoSQL store from a flow
- Provision databases and containers with a defined partition key as part of environment setup
- Run parameterized SQL queries to fetch documents matching filter criteria
- Upsert or replace documents to keep a container in sync with an external source
- Page through a container's documents using continuation tokens

## List of Actions

### Databases

- Create Database
- Delete Database
- Get Database
- List Databases

### Containers

- Create Container
- Delete Container
- Get Container
- List Containers

### Documents

- Create Document
- Delete Document
- Get Document
- List Documents
- Query Documents
- Replace Document
- Upsert Document

## List of Triggers

This service does not define any triggers.

## Authentication

Authenticates with a Cosmos DB master-key token (hand-rolled HMAC signing) — no OAuth. Configure two connection items:

- **Account Endpoint** — your account URI, e.g. `https://myaccount.documents.azure.com:443` (any trailing slash is stripped).
- **Master Key** — Cosmos DB → Settings → Keys → Primary Key (or a read-only key for read-only use).

The master-key signing is implemented by hand, so it is worth a live smoke test in FlowRunner after deployment — a single mismatch in the string-to-sign produces a 401.

## Notes

- **Partition key model** — Get, Create, Replace, and Delete Document require the document's partition key value; provide the raw value in the Partition Key Value parameter and the service serializes it to the JSON-array header (e.g. `["myPkValue"]`) for you. Containers are created with a hash partition key path (e.g. `/pk`).
- **Querying** — Query Documents runs parameterized SQL (`parameters` as an array of `{name,value}` objects with `@`-prefixed names) with cross-partition execution enabled, so filtering on the partition key is not required. Gateway-served queries do not support `ORDER BY`, `TOP`, `OFFSET/LIMIT`, aggregates, `DISTINCT`, or `GROUP BY`.
- **Pagination** — List Documents accepts a Max Item Count and returns a `continuationToken` when more results are available; pass it back on the next call. `null` means no more pages.
- **Errors** — Cosmos DB responses include a `code` and `message`, surfaced with the HTTP status. Common statuses: `401` (auth), `404` (not found), `409` (conflict), and `429` (throttled — the retry-after hint is included in the message).

## Agent Ideas

- Use **Azure Cosmos DB** "Query Documents" to pull records matching a filter, then write each result to **Azure Table Storage** "Insert Entity" to mirror the data into a cheaper structured store.
- Fetch a file with **Azure Blob Storage** "Get Blob", parse it in the flow, and call **Azure Cosmos DB** "Upsert Document" to load each parsed record into a container.
- When onboarding a new tenant, use **Azure Cosmos DB** "Create Database" and "Create Container" to provision storage, then log the created resource ids to **Azure Table Storage** "Insert Entity" for tracking.
