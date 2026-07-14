# MongoDB FlowRunner Extension

FlowRunner integration for [MongoDB](https://www.mongodb.com/) databases, including MongoDB Atlas. Connects directly to a MongoDB deployment using the official [`mongodb`](https://www.mongodb.com/docs/drivers/node/current/) Node.js driver and exposes the full document lifecycle (find, insert, update, replace, delete), aggregation pipelines, and collection/index management. It uses a **connect-per-call** model: every operation opens a short-lived `MongoClient`, runs its command, and always closes the connection when the call finishes — no clients or pools are cached between invocations.

## Ideal Use Cases

- Read, insert, update, and delete documents in an application database from within a workflow.
- Run aggregation pipelines ($match, $group, $lookup, $facet, ...) for reporting and analytics steps.
- Sync records between MongoDB and other apps (spreadsheets, CRMs, messaging tools).
- Discover a database's structure by listing collections and inspecting indexes.
- Bulk-load arrays of records fetched from an API or another service into a collection.

## List of Actions

### Documents

- **Find Documents** — query with full MongoDB filter syntax, projection, sorting, and limit/skip pagination (default limit 100).
- **Find One Document** — return the first matching document (or `null`), with optional projection.
- **Insert Document** — insert one document; returns the generated `_id` as a string.
- **Insert Documents** — bulk-insert an array of documents in a single call.
- **Update Document** — update the first matching document with update operators (plain objects are auto-wrapped in `$set`); optional upsert.
- **Update Documents** — update ALL matching documents; requires a non-empty filter.
- **Replace Document** — replace the entire matched document with a new one.
- **Delete Document** — delete the first matching document; requires a non-empty filter.
- **Delete Documents** — delete ALL matching documents; requires a non-empty filter.

### Aggregation

- **Count Documents** — count documents matching a filter (empty filter counts all).
- **Distinct Values** — distinct values of a field (dot notation supported) across matching documents.
- **Aggregate** — run an aggregation pipeline with `allowDiskUse: true` (120s execution limit).

### Collections

- **List Collections** — all collections and views in the database with their types.
- **Create Collection** — explicitly create a collection.
- **Drop Collection** — **destructive**: permanently deletes a collection with all its documents and indexes.

### Indexes

- **Create Index** — create an index from a keys spec (`{"email":1}`) with options (`unique`, `name`, `sparse`, `expireAfterSeconds` for TTL).
- **List Indexes** — all indexes on a collection.

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation opens a short-lived `MongoClient`, runs its command, and always closes the connection when the call finishes (success or failure). No clients or pools are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call.

- Connection establishment and server selection are bounded by the configurable **Connection Timeout** (default 10 seconds).
- **Aggregate** runs with an extended 120-second execution limit and `allowDiskUse: true`.

## Configuration

| Setting | Required | Description |
| --- | --- | --- |
| Connection String | Yes | Full MongoDB URI: `mongodb://` for self-hosted servers or `mongodb+srv://` for Atlas, e.g. `mongodb+srv://user:password@cluster0.xxxxx.mongodb.net`. Special characters in the username/password must be URL-encoded (`@` → `%40`). |
| Database | Yes | Name of the database to work with. All operations run against collections in this database. |
| Connection Timeout (seconds) | No | How long to wait when establishing a connection / selecting a server (default `10`). |

### MongoDB Atlas Quickstart

1. In the Atlas UI open your cluster and click **Connect → Drivers**, then copy the connection string (it looks like `mongodb+srv://user:<password>@cluster0.xxxxx.mongodb.net`). Replace `<password>` with the database user's password (URL-encoded).
2. Open **Network Access** (IP Access List) and allow connections from FlowRunner — either add `0.0.0.0/0` (allow from anywhere) or the FlowRunner egress IPs. **A blocked IP Access List is the #1 cause of Atlas connection timeouts** (`MongoServerSelectionError` / `ETIMEDOUT`).
3. Make sure the cluster is not paused and the database user has read/write permissions on the target database.

## ObjectId Handling

MongoDB documents are keyed by BSON `ObjectId` values, which are not valid JSON. This service converts them transparently in both directions:

- **Input:** any string of exactly 24 hex characters under an `_id` key — directly (`{"_id":"665f1c2ab7e4a3d2f0a11b22"}`), inside operators (`{"_id":{"$in":["665f...","665e..."]}}`), or under dotted paths ending in `._id` — is converted to an `ObjectId` in filters, documents, and pipeline stages. Non-24-hex string `_id` values (custom string ids) pass through untouched.
- **Output:** returned documents are made JSON-safe — `ObjectId` → 24-hex string, `Date` → ISO string, `Long` → number, `Decimal128` → number, `Binary` → base64 string.

## Safety Notes

- **Update Documents**, **Delete Document**, and **Delete Documents** require a non-empty filter to prevent accidental collection-wide writes from an empty input. To intentionally affect every document, use a match-all filter such as `{"_id":{"$exists":true}}`.
- **Update Document / Update Documents** wrap plain field/value objects in `$set` automatically, so `{"status":"archived"}` updates that one field instead of replacing the whole document. Use **Replace Document** for intentional full replacement.
- **Drop Collection** permanently deletes the collection, its documents, and its indexes — this cannot be undone.

## Agent Ideas

- Use MongoDB "Aggregate" to compute daily order totals, then use **Google Sheets** "Add Rows" to append them to a reporting spreadsheet for stakeholders.
- Use **Google Sheets** "Get Rows" to read a batch of records and MongoDB "Insert Documents" to load them into a collection.
- After MongoDB "Find Documents" surfaces records needing attention (e.g. overdue subscriptions), use **Gmail** "Send Message" or **Slack** "Send Message To Channel" to notify the responsible team.
