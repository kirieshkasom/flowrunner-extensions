# Chroma FlowRunner Extension

FlowRunner service for [Chroma](https://www.trychroma.com/), the open-source AI-native vector database. Manage collections and their records (embeddings, documents and metadata), and run nearest-neighbor similarity search — against **Chroma Cloud** or a **self-hosted** Chroma server — using Chroma's v2 REST API.

## Ideal Use Cases

- Store document embeddings and run semantic / nearest-neighbor search over them
- Build a RAG knowledge base: add documents, then query the most relevant chunks for an LLM prompt
- Keep an embedding store in sync by upserting records as source content changes
- Filter retrieval by metadata (`where`) or document content (`where_document`)

## List of Actions

### Collections

- Create Collection
- List Collections
- Get Collection
- Delete Collection
- Count Collections

### Records

- Add Records
- Upsert Records
- Update Records
- Query Records
- Get Records
- Count Records
- Delete Records

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Description |
|-------------|----------|-------------|
| **Base URL** | Yes | Chroma base URL. `https://api.trychroma.com` for Chroma Cloud, or `http://your-host:8000` for self-hosted. Any trailing slash is stripped automatically. |
| **API Key** | No | Chroma Cloud API key, sent as the `x-chroma-token` header. Leave empty for self-hosted instances that run without authentication. |
| **Tenant** | No | Chroma tenant id. Defaults to `default_tenant`. Use your tenant id on Chroma Cloud. |
| **Database** | No | Chroma database name within the tenant. Defaults to `default_database`. |

### Chroma Cloud vs self-hosted

- **Chroma Cloud** — set Base URL to `https://api.trychroma.com`, provide your **API Key**, and set **Tenant** / **Database** to your cloud tenant and database.
- **Self-hosted** — set Base URL to your server (e.g. `http://localhost:8000`). If the server runs without auth, leave **API Key** empty. Tenant/Database default to `default_tenant` / `default_database`.

All requests target the v2 API under `{baseUrl}/api/v2/tenants/{tenant}/databases/{database}/collections/...`. Chroma Cloud authenticates with the `x-chroma-token: <API Key>` header, which this service sets automatically when an API Key is configured.

## Notes

### Collections vs. records: name vs. UUID

Chroma identifies a collection two ways:

- **By name** — used for collection management (Get / Delete Collection).
- **By UUID `id`** — required by all record/data operations (Add, Upsert, Update, Query, Get, Count Records, Delete Records).

Create Collection and Get Collection both return the collection's `id`. For convenience, the record operations accept **either a collection name or its UUID**: if you pass a name, the service resolves it to the UUID automatically (via a get-collection lookup) before running the data operation. A value already shaped like a UUID is used as-is. The dictionary picker behind collection parameters shows the collection name as the label and the UUID id as the value.

### Records

- **Aligned arrays** — for Add / Upsert / Update, provide record IDs plus at least one of embeddings, documents and metadatas; all supplied arrays must align positionally by index.
- **`include`** — Query and Get accept an include list controlling which fields are returned: `documents`, `embeddings`, `metadatas`, `distances` (Query only) and `uris`.

### Errors

Chroma returns errors as `{ "error": "<type>", "message": "<detail>" }`. The service surfaces these as `Chroma API error: <type>: <message>`.

## Agent Ideas

- Use **OpenAI** "Create Embeddings" (or **Cohere** "Create Embeddings") to vectorize source text, then call **Chroma** "Add Records" to store the embeddings, documents and metadata for later retrieval.
- On a user question, embed it with **OpenAI** "Create Embeddings" and pass the vector to **Chroma** "Query Records" to fetch the most relevant documents for a RAG prompt.
- Retrieve top matches with **Chroma** "Query Records", then write a summary of the results into **Notion** "Create Page" to build a searchable knowledge base entry.
