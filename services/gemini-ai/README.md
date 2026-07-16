# Gemini AI FlowRunner Extension

Integrates Google's Gemini API into FlowRunner workflows with full provider coverage: multimodal content generation with Google Search grounding, URL context, code execution, and function calling; structured JSON output with response schemas; thinking-budget control for reasoning models; native image generation and editing (Nano Banana family); Veo video generation; text-to-speech with 30 voices and multi-speaker dialogue; embeddings; token counting; the Files API; explicit context caching; and half-price asynchronous batch processing. Generated images, audio, and video are saved to FlowRunner file storage and returned as URLs.

## Ideal Use Cases

- Analyzing documents, invoices, images, audio, and video with natural language prompts
- Extracting structured JSON data from unstructured content using response schemas
- Building research and Q&A agents grounded in Google Search results with citations
- Generating and editing marketing images, product visuals, and social media assets
- Producing narrated audio and multi-speaker dialogue from scripts
- Generating short cinematic videos from text prompts or starting images
- Powering semantic search and RAG pipelines with task-optimized embeddings
- Processing large document collections at 50% cost via batch jobs
- Reducing cost and latency of repeated large prompts with context caching

## List of Actions

### Content Generation

- Generate Content
- Generate Content (Advanced)
- Count Tokens

### Image Generation

- Generate Image

### Speech Generation

- Generate Speech

### Video Generation

- Generate Video
- Start Video Generation
- Get Video Operation
- Save Generated Video

### Embeddings

- Embed Content
- Batch Embed Contents

### Files

- Upload File
- List Files
- Get File Info
- Delete File

### Models

- List Models
- Get Model

### Context Caching

- Create Cached Content
- List Cached Contents
- Get Cached Content
- Update Cached Content
- Delete Cached Content

### Batch Processing

- Create Batch Job
- Get Batch Job
- List Batch Jobs
- Cancel Batch Job
- Delete Batch Job
- Download Batch Results

## Agent Ideas

- When a **Google Drive** "On New File" trigger fires, use **Gemini AI** "Upload File" then "Generate Content (Advanced)" with a response schema to extract structured data, and write the results into **Google Sheets** "Add Row" for automated document processing
- When a **Gmail** "On New Attachment" trigger fires, use **Gemini AI** "Upload File" and "Generate Content" to summarize the attachment, then send the summary back via **Gmail** "Send Message"
- Build a grounded research agent by calling **Gemini AI** "Generate Content (Advanced)" with Google Search enabled, then post the sourced digest (with its grounding citations) via **Slack** "Send Message To Channel"
