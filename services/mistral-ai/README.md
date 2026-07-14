# Mistral AI FlowRunner Extension

FlowRunner integration for the [Mistral AI](https://mistral.ai) platform (La Plateforme). Covers the current Mistral API surface: chat completions, vision, Document AI (OCR), embeddings, code fill-in-the-middle, moderation, Voxtral audio (transcription and text-to-speech), files, batch jobs, agents, server-side conversations, document libraries, and model discovery. Authenticates with a Mistral API key.

## Ideal Use Cases

- Generate, summarize, classify, or rewrite text with Mistral chat and code models inside a flow.
- Extract structured text from PDFs and images with Document AI (OCR).
- Transcribe audio and synthesize speech with the Voxtral models.
- Build retrieval-augmented agents backed by indexed document libraries.
- Run large jobs cheaply as asynchronous, discounted batch jobs.
- Moderate user-generated text or conversations for harmful content.

## List of Actions

### Chat
- Analyze Image
- Ask AI
- Create Chat Completion

### Document AI
- OCR Document

### Embeddings
- Create Embeddings

### Code
- FIM Completion

### Moderation
- Moderate Conversation
- Moderate Text

### Audio
- Text to Speech
- Transcribe Audio

### Files
- Delete File
- Download File
- Get File
- Get File Signed URL
- List Files
- Upload File

### Batch
- Cancel Batch Job
- Create Batch Job
- Get Batch Job
- List Batch Jobs

### Agents
- Create Agent
- Delete Agent
- Get Agent
- List Agents
- Update Agent

### Conversations
- Append to Conversation
- Get Conversation
- Get Conversation History
- Get Conversation Messages
- List Conversations
- Start Conversation

### Libraries
- Create Library
- List Libraries
- List Library Documents
- Upload Library Document

### Models
- Get Model
- List Models

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key | Yes | Your Mistral AI API key. Create one in La Plateforme at https://console.mistral.ai/api-keys |

## Notes

- Uses `https://api.mistral.ai/v1` with Bearer authentication.
- File-producing operations (Text to Speech, Download File) store results in FlowRunner file storage and expose a File Settings parameter for choosing the storage scope.
- The Agents, Conversations, and Libraries APIs are currently in beta on the Mistral platform.
- Dynamic parameter options (dictionaries) are provided for models, agents, TTS voices, uploaded files, and document libraries.

## Agent Ideas

- When a **Google Drive** "On New File" trigger fires for a scanned document, use **Mistral AI** "OCR Document" to extract per-page markdown, then **Mistral AI** "Ask AI" to summarize it and **Slack** "Send Message To Channel" to post the summary.
- Use **Mistral AI** "Transcribe Audio" to convert a meeting recording to text, then **Mistral AI** "Create Chat Completion" to produce action items and **Notion** "Create Page" to save the notes.
- Use **Mistral AI** "Create Embeddings" to vectorize incoming support tickets and **Google Sheets** "Add Row" to log each ticket alongside its embedding for downstream clustering.
