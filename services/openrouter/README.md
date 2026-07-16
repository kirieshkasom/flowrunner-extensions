# OpenRouter FlowRunner Extension

FlowRunner integration for [OpenRouter](https://openrouter.ai) — a unified API for hundreds of AI models from OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek and many more, with automatic routing, model fallbacks, provider preferences and transparent per-request cost accounting. Covers chat, vision, image/video generation, speech, embeddings, reranking and account insights.

## Ideal Use Cases

- Run chat completions against any provider through one API, with automatic failover and cheapest/fastest routing.
- Generate images and videos, transcribe audio, and synthesize speech without provider-specific integrations.
- Build RAG pipelines with embeddings plus rerank as a precision step after vector search.
- Track exact per-request spend and account balance for cost monitoring and low-credit alerts.

## List of Actions

### Chat
- Analyze Image
- Chat Completion
- Chat Completion (Advanced)

### Images
- Generate Image

### Audio
- Text to Speech
- Transcribe Audio

### Video
- Download Video
- Generate Video
- Get Video Status

### Embeddings
- Create Embeddings
- Rerank Documents

### Models
- Get Model Endpoints
- List Models
- List Providers

### Insights
- Get Generation

### Account
- Get Activity
- Get Credits
- Get Key Info

## List of Triggers

This service does not define any triggers.

## Authentication

API key. Set your OpenRouter API key (from https://openrouter.ai/settings/keys) in the API Key config item.

## Configuration

| Config Item | Required | Description |
|---|---|---|
| API Key | Yes | Your OpenRouter API key from https://openrouter.ai/settings/keys |
| App URL | No | Your app's URL, sent as the `HTTP-Referer` attribution header used for app rankings on openrouter.ai |
| App Title | No | Your app's display name, sent as the `X-OpenRouter-Title` attribution header |

## Notes

- Generated images, audio and video are stored via FlowRunner file storage (`@usesFileStorage`); the returned URLs can be passed to downstream actions.
- Every chat completion returns the generation `id`; feed it to **Get Generation** for exact cost accounting.
- Live, searchable model pickers back every model parameter (all/chat/vision/image/video/embeddings/TTS/STT/rerank models, plus a dependent voices dictionary), so all several-hundred models are reachable via server-side search and pagination.
- **Chat Completion** defaults to the `openrouter/auto` router; **Chat Completion (Advanced)** exposes the full provider routing preferences object, plugins (web search, file parser, context compression), tool calling and `json_schema` structured outputs.

## Agent Ideas

- After a **Chat Completion** (or **Analyze Image**) produces a summary, use **Notion** "Create Page" to file the result and **OpenRouter** "Get Generation" to record the exact credit cost alongside it.
- When a **Dropbox** "On New File" trigger fires for an audio drop folder, call **Dropbox** "Get Temporary Link" and pass the URL to **OpenRouter** "Transcribe Audio", then log the transcript to **Google Sheets** "Add Row".
- Poll **OpenRouter** "Get Credits" on a schedule and, when the remaining balance runs low, use **Slack** "Send Message To Channel" to alert the team before flows start failing.
