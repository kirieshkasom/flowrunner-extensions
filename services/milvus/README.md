# Milvus FlowRunner Extension

Connect FlowRunner to [Milvus](https://milvus.io) / [Zilliz Cloud](https://zilliz.com/cloud) — an
open-source vector database for similarity search and AI applications. Manage collections, write and
delete entities, run vector similarity search, and administer indexes and partitions through the
Milvus REST API v2.

## Ideal Use Cases

- Build a semantic search or retrieval-augmented generation (RAG) backend by storing embeddings and
  running nearest-neighbor search over them.
- Sync application data into a vector collection, keeping it current with insert, upsert, and delete
  operations.
- Filter and retrieve records by metadata (scalar fields) without vector similarity, or fetch
  specific rows by primary key.
- Administer a vector database — create and drop collections, indexes, and partitions, and manage
  load state — as part of an automated data pipeline.

## List of Actions

### Collections
Create Collection, List Collections, Describe Collection, Drop Collection, Has Collection, Get
Collection Stats, Load Collection, Release Collection.

### Entities
Insert Entities, Upsert Entities, Delete Entities, Search Entities (vector similarity search),
Query Entities (scalar filter), Get Entities (by ID).

### Indexes
Create Index, Describe Index, List Indexes, Drop Index.

### Partitions
List Partitions, Create Partition, Drop Partition.

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Cluster Endpoint** | Yes | The base URL of your database. For Zilliz Cloud, use the cluster's public endpoint (e.g. `https://in03-xxxx.serverless.gcp-us-west1.cloud.zilliz.com`). For self-hosted Milvus, use the REST endpoint (e.g. `http://your-host:19530`). Any trailing slash is stripped automatically. |
| **Token** | Yes | For Zilliz Cloud, your API key. For self-hosted Milvus, a `username:password` pair (e.g. `root:Milvus`). Sent as an `Authorization: Bearer <token>` header. |

All requests are made against `{Cluster Endpoint}/v2/vectordb`.

### Zilliz Cloud vs. self-hosted Milvus

- **Zilliz Cloud** — copy the *Public Endpoint* from your cluster's overview page as the Cluster
  Endpoint, and create an *API Key* to use as the Token.
- **Self-hosted Milvus** — point the Cluster Endpoint at your instance's REST port (`19530` by
  default) and use `username:password` as the Token. If authentication is disabled you can still use
  the default `root:Milvus` credentials.

## Typical Search Flow

1. **Create Collection** — quick setup with a `dimension` and `metricType` (Cosine / L2 / Inner
   Product), or a full custom `schema`.
2. **Create Index** on the vector field (e.g. `AUTOINDEX` with `COSINE`) if not created automatically.
3. **Load Collection** — a collection must be loaded into memory before it can serve searches or
   queries. This is required; searches against an unloaded collection return no results.
4. **Insert / Upsert Entities** — write rows whose keys match the collection's fields.
5. **Search Entities** — supply one or more query vectors and get the nearest neighbors back, ranked
   by distance, with optional scalar filtering and output fields.
6. **Release Collection** when done to free memory.

> **Load before search.** Search, Query, and Get all require the collection (and any relevant
> partitions) to be loaded first. If you get empty results, confirm the collection is loaded.

## Notes

The Milvus REST API v2 wraps every response as `{code, data, message}`, where `code: 0` indicates
success. This service unwraps and returns `data` on success and throws an error carrying the API
`message` and error `code` on failure.

## Agent Ideas

- Use **OpenAI** "Create Embeddings" (or **Cohere** "Create Embeddings") to turn a document into a
  vector, then call **Milvus** "Insert Entities" to store it in a loaded collection for later
  retrieval.
- On a user query, generate a query vector with **OpenAI** "Create Embeddings" and pass it to
  **Milvus** "Search Entities" to fetch the most relevant records, then feed those results back to
  **OpenAI** for a grounded, RAG-style answer.
- Use **Airtable** "Get Records" to pull a batch of new content, embed each row with **Cohere**
  "Create Embeddings", and sync them into Milvus via "Upsert Entities" to keep the vector index in
  step with your source of truth.
