# OpenAI FlowRunner Extension

Integrates OpenAI's full platform into FlowRunner workflows: text generation with the Responses and Chat Completions APIs (including structured JSON output, reasoning models, and built-in web search, file search, and code interpreter tools), image generation and editing, Sora video generation, text-to-speech, transcription and translation, embeddings, content moderation, file management, cost-saving batch jobs, and vector stores for retrieval-augmented generation.

## Ideal Use Cases

- Generating, summarizing, classifying, or extracting structured JSON data from text with GPT and o-series reasoning models
- Answering questions with current, cited information pulled from the web
- Building RAG pipelines: upload documents, index them in vector stores, and search or ground model answers on them
- Generating and editing marketing images with gpt-image-1, or producing short videos with Sora
- Converting text to narrated audio and transcribing or translating call recordings and voice memos
- Screening user-generated text and images for policy violations before publishing
- Processing large workloads asynchronously at half cost with the Batch API

## List of Actions

### Responses

- Create Response
- Get Response
- Cancel Response
- Delete Response
- List Response Input Items

### Chat

- Create Chat Completion

### Web Search

- Web Search

### Images

- Generate Image
- Edit Image

### Videos

- Create Video
- Remix Video
- Get Video
- List Videos
- Delete Video
- Download Video Content

### Audio

- Text to Speech
- Speech to Text
- Translate Audio

### Embeddings

- Create Embeddings

### Moderation

- Moderate Content

### Files

- Upload File
- List Files
- Get File
- Delete File
- Download File Content

### Batches

- Create Batch
- Get Batch
- List Batches
- Cancel Batch

### Vector Stores

- Create Vector Store
- List Vector Stores
- Get Vector Store
- Delete Vector Store
- Add File to Vector Store
- List Vector Store Files
- Remove File from Vector Store
- Search Vector Store

### Models

- List Models
- Get Model

## Agent Ideas

- Use **OpenAI** "Create Response" with a JSON schema to extract structured order details from incoming emails, then create records with **Airtable** "Create Record"
- Build a support knowledge base: upload docs with **OpenAI** "Upload File", index them via "Create Vector Store", and answer tickets with "Create Response" using file search over the store
- Use **OpenAI** "Moderate Content" on incoming user submissions, and if flagged, notify moderators via **Slack** "Send Message To Channel" before the content is published
- When a **Gmail** "On New Attachment" trigger fires with a voice memo, use **OpenAI** "Speech to Text" to transcribe it, then save the transcript into **Google Sheets** "Add Row"
- Generate product visuals with **OpenAI** "Generate Image", then publish them via **Google Drive** "Create File"
- Create a short promo clip with **OpenAI** "Create Video", poll "Get Video" until complete, then fetch it with "Download Video Content" and share the link in **Slack**
- Use **OpenAI** "Web Search" to answer a customer question with current information, then send the response via **Slack** "Send Message To Channel"
- Generate a script with an AI text step, convert it to narrated audio with **OpenAI** "Text to Speech", and upload the resulting file via **Google Drive** "Create File"
