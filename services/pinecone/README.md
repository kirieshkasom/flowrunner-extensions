# Pinecone FlowRunner Extension

FlowRunner extension for [Pinecone](https://www.pinecone.io), the managed vector database. Manage serverless indexes, upsert and query vectors, work with integrated-embedding text records, and call Pinecone's hosted inference models for embeddings and reranking — all from FlowRunner flows and AI agents.

## Ideal Use Cases

- Build retrieval-augmented generation (RAG) knowledge bases by upserting document chunks and running semantic search over them.
- Store and query embeddings produced by any model, or let Pinecone auto-embed raw text via integrated-embedding indexes.
- Rerank search or LLM results with Pinecone's hosted reranking models for higher relevance.
- Provision, configure, and clean up serverless indexes and namespaces programmatically from automations.

## List of Actions

### Indexes

- Configure Index
- Create Index
- Create Index for Model
- Delete Index
- Describe Index
- List Indexes

### Vectors

- Delete Vectors
- Describe Index Stats
- Fetch Vectors
- List Vector IDs
- Query Vectors
- Update Vector
- Upsert Vectors

### Records

- Search Records
- Upsert Records

### Namespaces

- Delete Namespace
- List Namespaces

### Inference

- Create Embeddings
- Rerank Documents

## List of Triggers

This service does not define any triggers.

## Configuration

| Config Item | Required | Description |
|---|---|---|
| API Key | Yes | Your Pinecone API key. Create one in the [Pinecone console](https://app.pinecone.io) under **API Keys**. |

All requests are sent with the `X-Pinecone-API-Version: 2025-10` header. Control-plane operations use `https://api.pinecone.io`; data-plane operations automatically resolve (and cache) the per-index host via Describe Index.

## Notes

- Index creation is asynchronous; poll **Describe Index** until `status.ready` is `true`.
- Upserts are eventually consistent; use **Describe Index Stats** to confirm data freshness.
- **Upsert Records** and **Search Records** work only on indexes created via **Create Index for Model**.
- **List Vector IDs** and **List Namespaces** are supported on serverless indexes only.
- Default embedding model is `multilingual-e5-large`; default reranking model is `bge-reranker-v2-m3`.

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires for a document, call **Dropbox** "Get Temporary Link" and feed the text into Pinecone "Upsert Records" to keep a semantic knowledge base in sync as files arrive.
- Answer a user question by embedding it with Pinecone "Search Records" (or "Query Vectors"), then use **Notion** "Create Page" to save the retrieved context and generated answer as a research note.
- After Pinecone "Query Vectors" returns the top matches for a support query, use **Slack** "Send Message To Channel" to post the most relevant knowledge-base snippets to the support channel.
- Log every Pinecone "Rerank Documents" run's top result into a spreadsheet with **Google Sheets** "Add Row" to track retrieval quality over time.
