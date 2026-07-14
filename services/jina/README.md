# Jina AI

FlowRunner service for [Jina AI](https://jina.ai) — a suite of search-foundation APIs for building
AI and RAG workflows: embeddings, reranking, web-page reading, web search, zero-shot
classification, text segmentation, and agentic deep search.

Jina AI spans several hosts (`api.jina.ai`, `r.jina.ai`, `s.jina.ai`, `deepsearch.jina.ai`); this
service routes each operation to the correct host for you.

## Authentication

All operations authenticate with a single API key sent as a Bearer token
(`Authorization: Bearer <apiKey>`).

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Your Jina AI key (a `jina_...` token). Get it from the [Jina AI API dashboard](https://jina.ai/api-dashboard). A free tier is available. |

## Operations

| Operation            | Category          | Description |
| -------------------- | ----------------- | ----------- |
| Create Embeddings    | Embeddings        | Generate task-specific vector embeddings for one or more texts (default `jina-embeddings-v3`). |
| Rerank Documents     | Search & Ranking  | Reorder candidate documents by relevance to a query (default `jina-reranker-v2-base-multilingual`). |
| Read URL             | Reader            | Fetch a web page and return clean, LLM-ready markdown, HTML, text, or a screenshot. |
| Search Web           | Reader            | Web search that returns the top results already fetched and cleaned into usable content. |
| Classify Texts       | Classification    | Zero-shot classification of texts against candidate labels, with confidence scores. |
| Segment Text         | Classification    | Tokenize and split long text into chunks for embedding or LLM context windows. |
| Deep Search          | Reader            | Agentic deep-research search (`jina-deepsearch-v1`) that iteratively searches, reads, and reasons. |

### Reader & Search for RAG

**Read URL** and **Search Web** are the core building blocks for retrieval-augmented generation:
they turn live web content into clean, model-ready text in a single call. Combine them with
**Create Embeddings** and **Rerank Documents** to build a full retrieval pipeline, and use
**Segment Text** to chunk long documents before embedding.

## Notes

- Model names are exposed as plain string parameters with sensible documented defaults, so you can
  opt into newer models without a config change.
- Reader and Search accept format options (Markdown / HTML / Text, plus link and image summaries)
  that map to Jina's `X-*` request headers.
- Deep Search can take significantly longer than a plain search because it performs multi-step
  research.

## Agent Ideas

- Use **Jina AI** "Read URL" to fetch and clean a web page, "Segment Text" to chunk it, and "Create Embeddings" to vectorize the chunks, then call **Qdrant** "Upsert Points" to index them for retrieval.
- On a user question, call **Pinecone** "Query Vectors" to retrieve candidate passages, pass them through **Jina AI** "Rerank Documents" for second-stage relevance, then send the top results to **Anthropic AI** "Ask Claude" to generate a grounded answer.
- Use **Jina AI** "Search Web" to pull fresh, pre-cleaned web content for a query and feed it into **Anthropic AI** "Ask Claude" to produce an up-to-date, cited summary.
