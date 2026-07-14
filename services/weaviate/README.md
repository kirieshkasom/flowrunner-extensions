# Weaviate FlowRunner Extension

FlowRunner integration for [Weaviate](https://weaviate.io), the open-source vector database.
Manage collections and objects through the REST API and run vector, semantic, keyword, and
hybrid searches through the GraphQL API — without writing GraphQL by hand (a raw GraphQL
escape hatch is included for advanced use cases).

## Ideal Use Cases

- Build a semantic search or RAG backend by inserting embeddings and querying them with vector, text, keyword, or hybrid search.
- Sync records from other systems into Weaviate collections in bulk and keep them up to date.
- Filter, count, and clean up stored objects with where filters and batch deletes.
- Run advanced GraphQL features (sort, groupBy, autocut, cross-references) through the raw query escape hatch.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Instance URL | Yes | REST endpoint of your Weaviate instance, e.g. `https://your-cluster.weaviate.network` or `http://localhost:8080`. |
| API Key | No | Weaviate API key, sent as an `Authorization: Bearer` header. Leave empty for self-hosted instances with anonymous access enabled. |
| Inference API Keys | No | JSON object of vectorizer module API key headers merged into every request, e.g. `{"X-OpenAI-Api-Key":"sk-..."}`. Needed for Search (Text) and Search (Hybrid) on collections that use external vectorizers such as `text2vec-openai`. |

## List of Actions

### Collections

- Create Collection
- List Collections
- Get Collection
- Delete Collection

### Objects

- Create Object
- Get Object
- Update Object (Merge)
- Replace Object
- Delete Object
- List Objects
- Batch Create Objects
- Batch Delete Objects

### Search

- Search (Vector)
- Search (Text)
- Search (Keyword)
- Search (Hybrid)
- GraphQL Query (Raw)
- Aggregate Count

### Utilities

- Get Meta
- Check Liveness

## List of Triggers

This service does not define any triggers.

## Notes

- All dedicated search operations accept a GraphQL-style JSON where filter, e.g.
  `{"path":["category"],"operator":"Equal","valueText":"news"}` (combine with
  `{"operator":"And","operands":[...]}`), and return the unwrapped result array from
  `data.Get.<Collection>`. When `Return Properties` is omitted, all scalar properties from
  the collection schema are returned automatically.
- Distance vs. certainty: `certainty` is available for cosine distance only, and the two
  thresholds are mutually exclusive (distance wins when both are set).
- GraphQL errors are surfaced as thrown errors even when the HTTP status is 200.
- Batch deletes are limited by the server (10,000 matches per call by default); repeat the
  call for larger deletions.
- Collection names must start with an uppercase letter (e.g. `Article`).

## Agent Ideas

- Use **OpenAI** "Create Embeddings" to vectorize a batch of documents, then call **Weaviate** "Batch Create Objects" to index them into a collection for semantic search.
- When a **Gmail** "On New Email" trigger fires, embed the message with **OpenAI** "Create Embeddings" and store it via **Weaviate** "Create Object" to build a searchable email knowledge base.
- Use **Weaviate** "Search (Hybrid)" to retrieve the most relevant records for a user question, then pass them to **OpenAI** as context for a grounded answer, and log the result with **Google Sheets** "Get Rows".
