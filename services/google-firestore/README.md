# Google Firestore FlowRunner Extension

FlowRunner integration for [Cloud Firestore](https://firebase.google.com/docs/firestore), the
NoSQL document database in Firebase / Google Cloud. Create, read, update, delete, list, query,
and aggregate documents — all with plain JSON in and plain JSON out. Authenticates with a Google
service account key (a signed JWT is exchanged for a short-lived access token).

## Ideal Use Cases

- Persist form submissions, webhook payloads, or AI-generated records into a Firestore collection.
- Look up or update user/app data stored in Firestore as part of an automation.
- Run structured or collection-group queries and aggregations (Count / Sum / Average) to power reports.
- Sync documents between Firestore and other systems (spreadsheets, warehouses, CRMs).

## List of Actions

### Documents

- Batch Get Documents
- Create Document
- Delete Document
- Get Document
- List Documents
- Update Document

### Queries

- Query Documents
- Run Aggregation Query

### Collections

- List Collection IDs

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Service Account Key (JSON) | Yes | Full contents of a service account JSON key file. |
| Project ID | No | Defaults to the `project_id` inside the key file. |
| Database ID | No | Defaults to `(default)`. Only change it if your project uses named Firestore databases. |

### Getting a service account key

1. Open the [Firebase Console](https://console.firebase.google.com/) and select your project.
2. Go to **Project Settings** (gear icon) → **Service accounts**.
3. Click **Generate new private key** and confirm. A JSON key file downloads.
4. Paste the **entire** file contents into the *Service Account Key (JSON)* config item.

The Firebase Admin SDK service account has full Firestore access. If you create a service account
in Google Cloud IAM instead, grant it the **Cloud Datastore User** role (or **Firebase Admin**).

## Operations

| Operation | Description |
| --- | --- |
| Create Document | Add a document to a collection, with an explicit or auto-generated ID. |
| Get Document | Fetch a document by path. |
| Update Document | Merge fields into a document (only the keys you send are written). |
| Delete Document | Delete a document by path. |
| List Documents | Page through a collection, optionally sorted. |
| Query Documents | Structured query: AND-combined field conditions, ordering, limit, collection group queries. |
| Batch Get Documents | Fetch many documents by path in one call; reports which paths were missing. |
| Run Aggregation Query | Count / Sum / Average over a (filtered) collection without reading documents. |
| List Collection IDs | List root collections, or a document's subcollections. |

## Plain-JSON value conversion

Firestore's REST API wraps every value in a typed envelope
(`{"stringValue":"a"}`, `{"integerValue":"42"}`, `{"mapValue":{"fields":{...}}}`, …). This
service converts in **both directions** so you never deal with the wire format:

**Writing** (`Create Document`, `Update Document`, query condition values):

| JSON you provide | Stored as |
| --- | --- |
| `"hello"` (any string, including ISO dates) | `stringValue` |
| `42` (whole number) | `integerValue` |
| `3.14` | `doubleValue` |
| `true` / `false` | `booleanValue` |
| `null` | `nullValue` |
| `[...]` | `arrayValue` (elements converted recursively) |
| `{...}` | `mapValue` (fields converted recursively) |

Strings are **never** auto-converted to timestamps — an ISO 8601 string stays a string. To store
a native Firestore type explicitly, pass a single-key wire-format object as the value; it is sent
verbatim:

```json
{
  "createdAt": { "timestampValue": "2026-07-01T12:00:00Z" },
  "location":  { "geoPointValue": { "latitude": 48.8566, "longitude": 2.3522 } },
  "owner":     { "referenceValue": "projects/my-project/databases/(default)/documents/users/abc" }
}
```

**Reading** (all operations): values come back as plain JSON. Integers become JavaScript numbers
(kept as strings only if they exceed the safe-integer range), doubles and booleans map directly,
`timestampValue` is returned as its ISO 8601 string, geo points become
`{"latitude":…,"longitude":…}`, arrays and maps convert recursively. Every returned document has
the shape:

```json
{
  "id": "abc",
  "path": "users/abc",
  "name": "projects/my-project/databases/(default)/documents/users/abc",
  "createTime": "2026-07-01T12:00:00.000000Z",
  "updateTime": "2026-07-02T08:30:00.000000Z",
  "data": { "name": "Alice", "age": 30 }
}
```

## Paths and subcollections

- **Collection paths** have an odd number of segments: `users`, `users/abc/orders`.
- **Document paths** have an even number: `users/abc`, `users/abc/orders/o123`.
- All paths are relative to the database root; the service builds the full resource name for you.
- Deleting a document does **not** delete its subcollections.
- `Query Documents` takes a collection **ID** (single segment) plus an optional
  *Parent Document Path* for subcollections, or *All Descendants* for collection group queries
  (every collection with that ID anywhere in the database).

## Query conditions

Conditions are `{field, op, value}` rows combined with **AND**. Operators: `==`, `!=`, `<`, `<=`,
`>`, `>=`, `array-contains`, `in`. The value is parsed as JSON (`42` → number, `true` → boolean,
`["a","b"]` → array, required for `in`); anything that isn't valid JSON is used as a plain string.
Nested fields use dot notation (`address.city`). Compound filters on different fields may require
a composite index — the Firestore error message includes a direct link to create it.

## Notes

- `Update Document` is a merge: an update mask is built from the top-level keys of your data, so
  unlisted fields are preserved. A nested object replaces the whole map field it targets. By
  default a missing document is created; enable *Must Exist* to fail instead.
- Aggregations are billed by index entries scanned, not documents read — far cheaper than
  fetching the documents to count them.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires, use Firestore "Create Document" to log the sender, subject, and body into a `messages` collection for later querying.
- Use Firestore "Query Documents" to pull matching records, then **Google Sheets** "Add Rows" to export them into a spreadsheet for reporting.
- Use **BigQuery** "Get Query Results" to compute a summary, then Firestore "Update Document" to write the aggregated figures back into a per-tenant config document consumed by your app.
