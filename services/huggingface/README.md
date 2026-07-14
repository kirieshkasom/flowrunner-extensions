# Hugging Face FlowRunner Extension

FlowRunner integration for [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers) and the Hugging Face Hub API. It gives flows access to thousands of open models — chat/LLM completion routed across partner providers (Groq, Together, Cerebras, Fireworks and more), task-specific inference (image generation, speech recognition, embeddings, summarization, translation, classification, fill-mask, question answering), and Hub model/dataset discovery. Authenticates with a single Hugging Face access token.

## Ideal Use Cases

- Generate chat/LLM responses or structured JSON output through the OpenAI-compatible router across many providers.
- Create images from text prompts and store them in FlowRunner file storage.
- Transcribe uploaded or public audio files into text with speech-recognition models.
- Produce embeddings for semantic search, clustering, or retrieval workflows.
- Summarize, translate, classify, fill masks, or answer questions over text as part of an automation.
- Search the Hugging Face Hub for models and datasets and fetch model metadata.

## List of Actions

### Chat
- Chat Completion
- Chat Completion (Advanced)

### Images
- Generate Image

### Audio
- Transcribe Audio

### Embeddings
- Create Embeddings

### Text Transformation
- Summarize Text
- Translate Text

### Text Analysis
- Answer Question
- Classify Text
- Classify Text (Zero-Shot)
- Fill Mask

### Hub
- Get Model Info
- Search Datasets
- Search Models

### Account
- Get Account Info

## List of Triggers

This service does not define any triggers.

## Configuration

- **Access Token** (`accessToken`, required) — Hugging Face access token sent as a Bearer credential for all Inference and Hub requests. Create one at [hf.co/settings/tokens](https://huggingface.co/settings/tokens); use a fine-grained token with the "Make calls to Inference Providers" permission (Hub read access is recommended for model/dataset search).

## Notes

- Model parameters are backed by live dictionaries: chat models come from the router model list; task models come from the Hub filtered by the task's `pipeline_tag` and `inference_provider=hf-inference`. You can always paste any Hub model ID directly.
- Task-specific operations call the HF Inference provider endpoints; models that are cold may take extra time to load on the first request.
- Chat operations are billed/routed through Inference Providers; provider availability per model varies and can be inspected with Search Models.
- The service has zero npm dependencies.

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires for an uploaded recording, call **Dropbox** "Get Temporary Link" and pass the URL to **Hugging Face** "Transcribe Audio", then use **Notion** "Create Page" to save the transcript.
- Use **Hugging Face** "Summarize Text" and "Classify Text" to condense and tag incoming content, then post the result with **Slack** "Send Message To Channel" for team review.
- After **Hugging Face** "Generate Image" creates an asset from a text prompt, log the prompt and output details with **Google Sheets** "Add Row" to track generated media.
