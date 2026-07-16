# Elasticsearch FlowRunner Extension

Integrate [Elasticsearch](https://www.elastic.co/elasticsearch) with FlowRunner. Index, search,
update, and manage documents and indices against any self-managed Elasticsearch cluster or an
Elastic Cloud deployment via the Elasticsearch REST API. Supports full Query DSL bodies, bulk
NDJSON operations, and API key or HTTP Basic authentication against your own `serverUrl`.

## Ideal Use Cases

- Index application data, logs, or content into Elasticsearch and make it full-text searchable.
- Run Query DSL searches, counts, and aggregations across one or more indices.
- Bulk-load or synchronize large datasets in a single NDJSON request.
- Bulk-update or bulk-delete documents matching a query without fetching them first.
- Manage index lifecycle: create with mappings/settings, inspect, refresh, and delete indices.
- Verify connectivity, credentials, and cluster health as a lightweight readiness check.

## List of Actions

### Documents

- Bulk
- Delete Document
- Get Document
- Index Document
- Update Document

### Search

- Count
- Search

### Query By

- Delete By Query
- Update By Query

### Indices

- Create Index
- Delete Index
- Get Index
- Get Mapping
- Index Exists
- List Indices
- Refresh Index

### Cluster

- Cluster Health
- Info

## List of Triggers

This service does not define any triggers.

## Configuration

| Setting      | Required | Description                                                                                          |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| Server URL   | Yes      | Your Elasticsearch endpoint, e.g. `https://myhost:9200` or an Elastic Cloud URL. Strip trailing `/`. |
| API Key      | No       | An Elasticsearch API key. When set, requests use `Authorization: ApiKey <key>`.                      |
| Username     | No       | Username for HTTP Basic authentication (used only when no API Key is set).                            |
| Password     | No       | Password for HTTP Basic authentication.                                                              |

### Authentication: ApiKey vs Basic

The service picks credentials in this order:

1. **API Key** — if provided, every request is sent with `Authorization: ApiKey <apiKey>`. This is
   the recommended method. Create a key in Kibana (Stack Management → API keys) or with the
   `POST /_security/api_key` endpoint. Use the encoded `"encoded"` value.
2. **HTTP Basic** — if no API key is set but a Username/Password is, requests are sent with
   `Authorization: Basic base64(username:password)`.
3. **None** — if neither is configured, requests are sent unauthenticated (only for clusters with
   security disabled).

## Query DSL

Search, Count, Delete By Query, and Update By Query accept an Elasticsearch **Query DSL** object in
the `query` parameter. Examples:

```json
{ "match": { "title": "widget" } }
```

```json
{ "bool": { "must": [ { "term": { "status": "active" } } ], "filter": [ { "range": { "price": { "lte": 100 } } } ] } }
```

Omit the query to match all documents. See the
[Query DSL reference](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html).

## Bulk NDJSON

The **Bulk** operation accepts an array of operation objects and builds the newline-delimited JSON
(NDJSON) body the `_bulk` API expects, sending it with `Content-Type: application/x-ndjson`. Each
operation has an `action` (`index`, `create`, `update`, or `delete`) plus metadata; index/create
carry a `source`, update carries `doc` and/or `script` (plus optional `upsert`), and delete carries
no body:

```json
[
  { "action": "index",  "_index": "products", "_id": "1", "source": { "name": "Widget", "price": 9.99 } },
  { "action": "update", "_index": "products", "_id": "1", "doc": { "price": 8.49 } },
  { "action": "delete", "_index": "products", "_id": "2" }
]
```

This is converted to:

```
{"index":{"_index":"products","_id":"1"}}
{"name":"Widget","price":9.99}
{"update":{"_index":"products","_id":"1"}}
{"doc":{"price":8.49}}
{"delete":{"_index":"products","_id":"2"}}
```

Provide a **Default Index** to omit `_index` on individual operations (the request is then sent to
`/{index}/_bulk`).

## Refresh

Write operations expose a **Refresh** option:

- **No Refresh** (`false`) — default; changes become searchable on the next scheduled refresh.
- **Refresh Now** (`true`) — force an immediate refresh (expensive; avoid in high-throughput flows).
- **Wait For Refresh** (`wait_for`) — block until the next refresh makes the change visible.

## Notes

- Index-name parameters offer a dictionary populated from `GET /_cat/indices`; you can also type a
  name, comma-separated list, or wildcard directly.
- Errors surface the Elasticsearch `error.reason` (or `type`) and HTTP `status`.

## Agent Ideas

- Use **PostgreSQL** "Execute Query" to pull recent records, then call **Elasticsearch** "Bulk" to index them all in a single NDJSON request so they become full-text searchable.
- When an incident is flagged, run **Elasticsearch** "Search" with a Query DSL body to find matching log documents, then use **Slack** "Send Message To Channel" to alert the on-call team with the top hits.
- Run **Elasticsearch** "Count" to check how many documents match an alert query, and if the total crosses a threshold use **Gmail** "Send Message" to email a summary to stakeholders.
