# Azure OpenAI FlowRunner Extension

FlowRunner integration for [Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/) — run OpenAI models (GPT-4o, o-series, DALL-E 3, gpt-image-1, Whisper, TTS, and embeddings) hosted in your own Azure subscription. Every action targets a **deployment** you created in Azure, so chat, vision, embeddings, image generation, transcription, translation, and speech synthesis all run under your resource's data residency and content-safety controls.

## Ideal Use Cases

- Generate or summarize text with GPT-4o / o-series models governed by your organization's Azure compliance and content-filtering policies
- Analyze images or scanned documents with a vision-capable deployment
- Produce vector embeddings for semantic search or RAG pipelines using your own text-embedding deployment
- Create marketing or product imagery from prompts with DALL-E 3 or gpt-image-1
- Transcribe or translate audio (Whisper / gpt-4o-transcribe) and synthesize speech (TTS) for voice workflows

## List of Actions

### Chat

- Analyze Image
- Ask AI
- Chat Completion (Advanced)

### Embeddings

- Create Embeddings

### Images

- Generate Image

### Audio

- Text To Speech
- Transcribe Audio
- Translate Audio

## List of Triggers

This service does not define any triggers.

## Authentication

The service authenticates with the `api-key` header on both request surfaces. Configure these items on the connection:

| Item | Required | Description |
| --- | --- | --- |
| API Key | Yes | One of the two keys of your Azure OpenAI resource. |
| Endpoint | Yes | Your resource endpoint, e.g. `https://my-resource.openai.azure.com` (no trailing slash). Foundry-style endpoints (`https://my-resource.services.ai.azure.com`) also work on the `v1` surface. |
| API Version | No | Defaults to `v1` (recommended). Set a dated version (e.g. `2024-10-21`) only for legacy routing — see Notes. |

## Notes

- **Uses FlowRunner file storage** for generated images and synthesized speech, so connected flows have file storage provisioned automatically.
- **Content safety** — Azure applies its content filtering system to prompts and completions. The chat operations surface `content_filter_results` (per choice) and `prompt_filter_results` (per input) when the service returns them.

### Finding your endpoint, key, and deployment name

1. **Endpoint and key** — In the [Azure portal](https://portal.azure.com), open your Azure OpenAI resource and go to **Keys and Endpoint** (under *Resource Management*). Copy the **Endpoint** (e.g. `https://my-resource.openai.azure.com`) and **KEY 1** or **KEY 2**.
2. **Deployment name** — In [Azure AI Foundry](https://ai.azure.com) (formerly Azure OpenAI Studio), open **Deployments**. Every action in this integration takes the **deployment name** you assigned when you deployed a model (e.g. `my-gpt-4o`), **not** the underlying model name. You must create a deployment for each model you want to use (chat, embeddings, image, speech, etc.).

> Deployments cannot be listed with the data-plane API key — listing them requires management-plane Azure AD (Entra ID) credentials — so this integration asks you to enter the deployment name directly instead of offering a dropdown.

### `v1` vs. dated API versions

Azure OpenAI exposes two request surfaces, and the **API Version** config item selects between them:

- **`v1` (default, recommended)** — the modern OpenAI-compatible surface. Requests go to `{endpoint}/openai/v1/{path}` (e.g. `/openai/v1/chat/completions`) with the deployment name passed as the `model` property, and no `api-version` query parameter is needed. It always tracks the latest generally available capabilities.
- **Dated version (legacy)** — e.g. `2024-10-21`. Requests go to the per-deployment paths `{endpoint}/openai/deployments/{deployment}/{path}?api-version={version}`. Use this only if your resource, network policy, or gateway still requires the legacy routing. Older dated versions may not support newer request fields used by this integration (such as `max_completion_tokens` or `reasoning_effort`).

## Agent Ideas

- Chain **Azure OpenAI** "Transcribe Audio" to turn a recording into text, then "Ask AI" to summarize it, and use **Notion** "Create Page" to file the summary as meeting notes.
- Analyze a screenshot dropped into cloud storage — trigger on **Dropbox** "On New File", resolve it with "Get Temporary Link", run **Azure OpenAI** "Analyze Image", then post the result with **Slack** "Send Message To Channel".
- Generate marketing copy with **Azure OpenAI** "Ask AI" and a matching visual with "Generate Image", then log the prompt, copy, and image URL to a spreadsheet via **Google Sheets** "Add Row".
