# Azure AI Search FlowRunner Extension

FlowRunner integration for [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/) (formerly Azure Cognitive Search) — a fully managed cloud search service for information retrieval over your content. This service exposes index management, document ingestion, and keyword / vector / hybrid search against the Azure AI Search data-plane REST API.

## Ideal Use Cases

- Build retrieval-augmented generation (RAG) pipelines that ground an LLM in your own content via keyword, vector, or hybrid search.
- Power search-as-you-type experiences with type-ahead suggestions and query auto-completion.
- Manage search indexes and their field schemas (including vector and semantic configurations) from an automation.
- Batch-ingest, update, or delete documents in an index as content changes elsewhere in your stack.
- Automate pull-model ingestion by triggering indexers on demand and monitoring their run status.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Search Service Name** | Yes | Your search service name — the `{serviceName}` part of your endpoint `https://{serviceName}.search.windows.net`. |
| **API Key** | Yes | An API key from the Azure portal (**your Search service → Keys**). See admin vs. query keys below. |
| **API Version** | No | The REST `api-version`. Defaults to `2024-07-01` (current GA). Only change if you need a specific version. |

### Admin keys vs. query keys

Azure AI Search supports two kinds of API keys:

- **Admin keys** grant full read-write access — required for any write operation: Create Index, Delete Index, Index Documents, and Run Indexer.
- **Query keys** grant read-only access to the documents collection — sufficient for read operations: Search Documents, Get Document, Count Documents, Suggest, and Autocomplete.

Use the least-privileged key that covers the operations you need. All requests authenticate via the `api-key` request header.

### API version

Requests include the `api-version` query parameter. The service defaults to the current GA version `2024-07-01`. You only need to override this if you require a newer preview feature or must pin to a specific version.

## Operations

### Indexes

- **Create Index** — Create or update an index (idempotent PUT). Define the field schema (name, type, key, searchable, filterable, sortable, facetable, retrievable; vector fields add `dimensions` + `vectorSearchProfile`) and optionally a `vectorSearch` and `semantic` configuration.
- **List Indexes** — List all indexes on the service.
- **Get Index** — Retrieve a single index definition.
- **Delete Index** — Permanently delete an index and its documents.
- **Get Index Statistics** — Document count and storage size for an index.

### Documents

- **Search Documents** — The flagship query operation. Supports **keyword**, **vector**, and **hybrid** search plus filtering, sorting, faceting, paging, hit highlighting, and semantic ranking. Results include an `@search.score` per document.
- **Index Documents** — Batch upload / merge / delete documents. Each entry carries a `@search.action` verb (see below) plus the document fields.
- **Get Document** — Retrieve a single document by key.
- **Count Documents** — Current document count for an index.
- **Suggest** — Type-ahead document suggestions from a configured suggester.
- **Autocomplete** — Completed query terms from a configured suggester.

### Indexers (pull model)

- **List Indexers** — List indexers on the service.
- **Run Indexer** — Trigger an on-demand indexer run.
- **Get Indexer Status** — Current status and execution history of an indexer.

## Search modes

**Search Documents** covers three retrieval styles:

- **Keyword** — set **Search Text** (with optional `queryType` Simple or Full/Lucene).
- **Vector** — set **Vector Queries** (each with a `vector` or `text`, target `fields`, and `k`); leave Search Text empty or `*`.
- **Hybrid** — set **both** Search Text and Vector Queries; Azure fuses the results.

Set **Query Type** to `Semantic` with a **Semantic Configuration** name to add semantic re-ranking on top of any of the above.

## `@search.action` (Index Documents)

Each document in the **Documents** array must include a `@search.action`:

| Action | Behavior |
| --- | --- |
| `upload` | Insert a new document or fully replace an existing one. |
| `merge` | Update the specified fields of an existing document (fails if it does not exist). |
| `mergeOrUpload` | Merge if the document exists, otherwise upload it as new. |
| `delete` | Remove a document; only the key field is required. |

Example document array entry:

```json
{ "@search.action": "mergeOrUpload", "id": "1", "name": "Fairmont", "category": "Luxury" }
```

## List of Triggers

This service does not define any triggers.

## Notes

- Batches are limited to 1000 documents or 16 MB per Index Documents request.
- Document counts and index statistics can lag recent indexing by a few seconds.
- Suggest and Autocomplete require a **suggester** to be defined on the target index.

## Agent Ideas

- Use **Azure OpenAI** "Create Embeddings" to vectorize new content, then call **Azure AI Search** "Index Documents" with a `mergeOrUpload` action to keep a vector index in sync.
- Answer a user question by calling **OpenAI** "Create Embeddings" on the query, passing the vector into **Azure AI Search** "Search Documents" as a hybrid query, then feeding the retrieved documents to **Azure OpenAI** "Ask AI" for a grounded RAG response.
- After **Azure AI Search** "Search Documents" returns candidate documents, call **Cohere** "Rerank Documents" to reorder them by relevance before presenting the top results.
