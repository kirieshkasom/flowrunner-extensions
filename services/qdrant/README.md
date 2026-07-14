# Qdrant FlowRunner Extension

Integrates [Qdrant](https://qdrant.tech), the open-source vector database and similarity search engine, into FlowRunner workflows. Manage collections, upsert and retrieve points with their vectors and payloads, run similarity searches via the universal Query API, and maintain point metadata — working with both Qdrant Cloud and self-hosted instances over the Qdrant REST API.

## Ideal Use Cases

- Building semantic search and retrieval-augmented generation (RAG) pipelines
- Storing embeddings produced by AI models alongside rich metadata payloads
- Finding nearest-neighbor points to a query vector or an existing point
- Filtering, counting, and paging through large sets of vector points
- Provisioning and inspecting vector collections as part of a data pipeline

## List of Actions

### Collections

- Check Collection Exists
- Create Collection
- Delete Collection
- Get Collection
- List Collections

### Points

- Batch Query Points
- Count Points
- Delete Points
- Get Points
- Query Points
- Scroll Points
- Upsert Points

### Payload

- Clear Payload
- Delete Payload Keys
- Overwrite Payload
- Set Payload

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Instance URL | Yes | Base URL of your Qdrant instance, e.g. `https://xyz-example.eu-central.aws.cloud.qdrant.io:6333` (Qdrant Cloud) or `http://your-host:6333` (self-hosted). |
| API Key | No | Qdrant API key, sent as the `api-key` header. Required for Qdrant Cloud (create one on the cluster's Data Access Control page); optional for self-hosted instances running without authentication. |

## Notes

- Point IDs are unsigned integers or UUID strings; numeric strings entered in the UI are automatically converted to integer IDs.
- Payload and delete operations select points either by an explicit ID list or by a [Qdrant filter](https://qdrant.tech/documentation/concepts/filtering/) — provide exactly one selector.
- Qdrant wraps every REST response as `{status, time, result}`; this service unwraps and returns the `result` value directly.
- Write operations (upsert, delete, payload changes) are sent with `wait=true`, so they return only after the changes are applied.

## Agent Ideas

- Use **OpenAI** "Create Embeddings" (or **Gemini AI** "Embed Content") to embed a document, then **Qdrant** "Upsert Points" to store the vector with its source metadata as the payload.
- Embed a user question with **OpenAI** "Create Embeddings", run **Qdrant** "Query Points" to retrieve the most similar passages, then feed them to **OpenAI** "Create Chat Completion" for a grounded, retrieval-augmented answer.
- After **Qdrant** "Query Points" surfaces relevant records, use **Notion** "Create Page" to log the matched results or **Slack** "Send Message To Channel" to alert a team with the top hits.
