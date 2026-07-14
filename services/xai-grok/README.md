# xAI Grok FlowRunner Extension

FlowRunner integration for the [xAI API](https://docs.x.ai) — frontier Grok models (Grok 4.5, Grok 4.3 and more) with chat completion, real-time answers via Live Search across web/X/news/RSS, image understanding, Grok Imagine image and video generation, tokenization, and full model/pricing metadata.

## Authentication

The service uses an API key (Bearer token). Create one at [console.x.ai](https://console.x.ai) (API Keys page) and set it in the `API Key` config item (`apiKey`, required).

## Ideal Use Cases

- Generating text responses, summaries, classifications or structured JSON from a single prompt
- Answering questions grounded in real-time web, X, news and RSS data with source citations (Live Search)
- Building multi-turn chatbots with tool/function calling and structured outputs (json_schema)
- Running long tasks asynchronously with deferred completions and polling for results
- Extracting text or answering questions about images with vision-capable Grok models
- Generating and editing images with Grok Imagine, optionally saved to FlowRunner file storage
- Generating, editing and extending short videos with Grok Imagine video models
- Estimating prompt cost and context fit via tokenization, and inspecting model pricing metadata

## List of Actions

### Chat
- Chat Completion
- Chat Completion (Advanced)
- Get Deferred Completion

### Live Search
- Ask with Live Search

### Vision
- Analyze Image

### Image Generation
- Generate Image
- Edit Image

### Video Generation
- Generate Video
- Edit Video
- Extend Video
- Get Video Result

### Models
- Get Model
- List Models
- List Language Models
- List Image Generation Models
- List Video Generation Models

### Account
- Get API Key Info

### Utilities
- Tokenize Text

## List of Triggers

This service does not define any triggers.

## Notes

- Base URL: `https://api.x.ai/v1` (OpenAI-compatible chat/images endpoints plus xAI-specific endpoints).
- Live Search uses the `search_parameters` request object; citations used by the model are returned in the response. `Ask with Live Search` provides guided source configuration (web/X/news/RSS, date ranges, country, allowed/excluded websites, X handle filters, max results); `Chat Completion (Advanced)` accepts a raw `search_parameters` object for full control.
- `reasoning_effort` (None/Low/Medium/High) is currently accepted only by `grok-4.3`; leave it empty for other models.
- Video generation, editing and extension are asynchronous: they return a `request_id` which must be polled with `Get Video Result` until the video is ready.
- `Generate Image` / `Edit Image` return xAI-hosted URLs by default (temporary); enable `Save to File Storage` to store the images in FlowRunner file storage and get permanent URLs.
- Dynamic dropdowns are provided for all models, chat/language models, image generation models and video generation models, populated live from the xAI model endpoints (including context window and modality notes).
- Not covered by this extension: the stateful Responses API, Files/Collections (document search), Batches, and the Voice/realtime APIs.

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires for a new image, call **Dropbox** "Get Temporary Link" and pass the URL to **xAI Grok** "Analyze Image" to extract text or a description, then log it with **Google Sheets** "Add Row".
- Use **xAI Grok** "Ask with Live Search" to gather real-time web/X/news context on a topic, then send the answer with its citations to a team via **Slack** "Send Message To Channel".
- Use **xAI Grok** "Generate Image" (saved to file storage) to create a hero image from a prompt, then publish it into a **Notion** "Create Page" as part of a content-drafting workflow.
