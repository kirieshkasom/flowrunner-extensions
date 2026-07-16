# Cohere FlowRunner Extension

Connect FlowRunner to the [Cohere](https://cohere.com) platform for enterprise-grade language AI: chat and reasoning with the Command model family, best-in-class Retrieval-Augmented Generation with verifiable fine-grained citations, multimodal embeddings, semantic reranking, text classification, tokenization, audio transcription, and asynchronous batch and embed jobs over large datasets. Authenticates with a single Cohere API key.

## Ideal Use Cases

- Build grounded RAG assistants that answer strictly from your documents and return citations mapping every claim to its source.
- Improve search and retrieval quality by reranking candidate documents by semantic relevance to a query.
- Generate multimodal embeddings for texts and images to power semantic search, clustering, and classification.
- Classify support tickets, content, or feedback few-shot or with a fine-tuned model.
- Transcribe audio files into text across 14 languages.
- Process large corpora asynchronously with batch chat jobs and embed jobs over uploaded datasets.

## List of Actions

### Chat

- Chat
- Chat (Advanced)
- Chat with Documents

### Embeddings

- Create Embeddings

### Rerank

- Rerank Documents

### Classification

- Classify Text

### Tokenization

- Detokenize Text
- Tokenize Text

### Audio

- Transcribe Audio

### Batches

- Cancel Batch
- Create Batch
- Get Batch
- List Batches

### Datasets

- Create Dataset
- Delete Dataset
- Get Dataset
- Get Dataset Usage
- List Datasets

### Embed Jobs

- Cancel Embed Job
- Create Embed Job
- Get Embed Job
- List Embed Jobs

### Models

- Get Model
- List Models

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** (required) — Your Cohere API key from the Cohere dashboard, used as a Bearer token on every request.

## Notes

- Base URL: `https://api.cohere.com` (v2 endpoints preferred; v1 used where it is the current API).
- Default models: chat `command-a-plus-05-2026`, embeddings `embed-v4.0`, rerank `rerank-v4.0-pro`, transcription `cohere-transcribe-03-2026`.
- Deprecated Cohere endpoints (Generate, Summarize, Connectors, Fine-tuning API) are intentionally not exposed.
- Dynamic dropdowns are provided for models (all, chat, embed, rerank, classify), datasets, batches, and embed jobs.

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires for an audio file, call **Dropbox** "Get Temporary Link" then Cohere "Transcribe Audio" to convert the recording to text, and Cohere "Chat" to summarize it.
- Use **Google Sheets** "Get Rows" to pull a set of documents, call Cohere "Rerank Documents" against a query to surface the most relevant ones, then answer with Cohere "Chat with Documents" for a fully cited response.
- After Cohere "Classify Text" categorizes an incoming message, use **Notion** "Create Page" to file it into the matching database, or **Google Sheets** "Add Row" to log the prediction and confidence score.
