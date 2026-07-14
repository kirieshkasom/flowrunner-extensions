# Google Vertex AI FlowRunner Extension

FlowRunner integration for [Google Vertex AI](https://cloud.google.com/vertex-ai), Google Cloud's enterprise AI platform. Generate text and multimodal content with Gemini models, create embeddings, generate images with Imagen, and call any partner or open model (Anthropic Claude, Meta Llama, Mistral, AI21, and more) through the Vertex AI Model Garden. Authentication is self-contained: the service signs a service-account JWT and exchanges it for a Google Cloud access token, with no SDK, no OAuth consent screen, and zero npm dependencies.

## Ideal Use Cases

- Generate text, summaries, or structured JSON output from Gemini models grounded in Google Search
- Analyze multimodal inputs (images, audio, video, PDFs) alongside conversation history
- Create dense vector embeddings for semantic search, classification, or retrieval pipelines
- Generate images from text prompts with Imagen and store them as shareable file URLs
- Call enterprise partner models (Anthropic Claude, Meta Llama, Mistral) through Model Garden
- Estimate token usage before a request to stay within context windows and manage cost

## List of Actions

### Content Generation

- Count Tokens
- Generate Content
- Generate Content (Advanced)

### Embeddings

- Create Embeddings

### Image Generation

- Generate Image

### Model Garden

- Call Partner Model
- Predict

## List of Triggers

This service does not define any triggers.

## Configuration

- **Service Account Key (JSON)** (required): Full JSON key file of a service account with the **Vertex AI User** role (`roles/aiplatform.user`). Paste the entire contents of the downloaded file.
- **Project ID** (optional): Google Cloud project to bill requests against. Defaults to `project_id` from the key file.
- **Region** (required): Vertex AI region (default `us-central1`), e.g. `europe-west4`, or `global` for the global endpoint. Model availability varies by region.

### Creating a service account key

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select (or create) the project you want to use.
2. Enable the **Vertex AI API**: APIs & Services > Library > search "Vertex AI API" > Enable.
3. Go to **IAM & Admin > Service Accounts** and click **Create Service Account**.
4. Give it a name (e.g. `flowrunner-vertex`), then grant it the role **Vertex AI User** (`roles/aiplatform.user`).
5. Open the created service account, go to the **Keys** tab, and click **Add Key > Create new key > JSON**. A `.json` file downloads.
6. Paste the **entire contents** of that file into the *Service Account Key (JSON)* config item.

The service builds an RS256-signed JWT from the key, exchanges it at `https://oauth2.googleapis.com/token` for a one-hour access token, and caches the token in memory until shortly before expiry.

## Notes

- **Model names are plain strings** (with sensible defaults such as `gemini-2.5-flash`, `gemini-embedding-001`, and `imagen-4.0-generate-001`) rather than dropdowns or dictionaries. This is intentional: Vertex AI model availability is **per project and per region**, Model Garden partner models must be individually enabled in the console, and there is no practical API for listing which publisher models a given project/region combination can actually call. Check the [model reference](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models) and the Model Garden page of your project for what is available to you. This is also why the service intentionally omits a "List Models" action.
- **Regions**: not every model is available in every region. `us-central1` has the broadest coverage; `global` routes Gemini requests to Google's global endpoint.
- **Partner models (Anthropic, Meta, Mistral, ...)**: use **Call Partner Model** with the publisher's native request schema. For Anthropic, include `"anthropic_version": "vertex-2023-10-16"` in the request body and use the Messages API shape. Partner models may need to be enabled in Model Garden first.
- **Embeddings**: texts are embedded one request per text for compatibility with `gemini-embedding-001` (which accepts a single instance per call); vectors are returned in input order.
- **Images**: generated images are stored in FlowRunner file storage (scope selectable: FLOW/WORKSPACE/EXECUTION) and returned as public URLs.

## Agent Ideas

- Use **Google Drive** "On New File" trigger and "Download File" to fetch an uploaded contract, then call **Google Vertex AI** "Generate Content (Advanced)" with the PDF as inline media to extract structured JSON terms.
- Call **Google Vertex AI** "Generate Content" to draft a customer response, then use **Slack** "Send Message To Channel" to post it for human review before sending.
- Use **Google Vertex AI** "Generate Image" to produce marketing visuals from a prompt, then **Notion** "Create Page" to publish the generated image URLs into a content calendar.
- Call **Google Vertex AI** "Create Embeddings" for each row of source text, then use **Google Sheets** "Add Row" to store the vectors alongside their labels for a lightweight semantic index.
