# Groq FlowRunner Extension

FlowRunner integration for the [Groq API](https://console.groq.com/docs) — ultra-fast AI inference for open models (Llama, GPT-OSS, Qwen, Whisper, Orpheus and Groq's agentic Compound systems). Provides chat completion, image analysis, audio transcription/translation, text-to-speech, and asynchronous batch processing.

## Authentication

The service uses an API key (Bearer token). Create one at [console.groq.com/keys](https://console.groq.com/keys) and set it in the `API Key` config item (`apiKey`, required).

## Ideal Use Cases

- Generating fast, low-latency text responses, summaries, or classifications from a single prompt
- Building multi-turn chatbots with tool/function calling and structured JSON outputs
- Extracting text or answering questions about images with multimodal vision models
- Transcribing or translating audio files (meeting recordings, voice notes) into text
- Converting text into natural-sounding speech for voice notifications or content
- Running large volumes of requests asynchronously at a 50% cost discount via batch jobs

## List of Actions

### Chat
- Chat Completion
- Chat Completion (Advanced)

### Vision
- Analyze Image

### Audio
- Text to Speech
- Transcribe Audio
- Translate Audio

### Files
- Delete File
- Download File Content
- Get File
- List Files
- Upload File

### Batches
- Cancel Batch
- Create Batch
- Get Batch
- List Batches

### Models
- Get Model
- List Models

## List of Triggers

This service does not define any triggers.

## Notes

- Base URL: `https://api.groq.com/openai/v1` (OpenAI-compatible).
- Audio inputs are downloaded by the service and sent as multipart uploads, so both FlowRunner file URLs and public URLs work.
- Selecting timestamp granularities automatically switches transcription output to `verbose_json`, as required by the API.
- Text to Speech and Download File Content save their output to FlowRunner file storage and return the file URL.
- Dynamic dropdowns are provided for all Groq models, chat models, Whisper models, TTS models, TTS voices (dependent on the selected model), uploaded files and batches.

## Agent Ideas

- Use **Groq** "Transcribe Audio" to convert a meeting recording into text, then call **Notion** "Create Page" to save the transcript and **Slack** "Send Message To Channel" to post a short summary produced by **Groq** "Chat Completion".
- When a **Dropbox** "On New File" trigger fires for an uploaded image, call **Dropbox** "Get Temporary Link" and pass the URL to **Groq** "Analyze Image" to extract text or describe the content for downstream processing.
- Use **Groq** "Chat Completion" to draft a reply or notification, send it with **Gmail** "Send Message", and log the outcome with **Google Sheets** "Add Row".
