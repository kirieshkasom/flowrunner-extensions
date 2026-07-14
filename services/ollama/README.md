# Ollama FlowRunner Extension

FlowRunner integration for [Ollama](https://ollama.com) — run open-source large language models
(Llama, Qwen, DeepSeek, Gemma, Mistral and more) on your own hardware and use them directly in
your flows. The service talks to Ollama's native REST API (`/api/*`) on a server you host, with
support for text generation, multi-turn chat (tool calling and vision), embeddings, and full model
management. All model parameters offer a dropdown populated from the models installed on your server.

## Ideal Use Cases

- Running private, self-hosted LLM inference for chat, completion, and reasoning without sending data to third-party APIs
- Building retrieval-augmented generation (RAG) pipelines using local embedding models
- Multi-turn conversational agents with tool/function calling and vision (image) support
- Structured data extraction using JSON mode or JSON-schema-constrained outputs
- Managing local model storage: pulling, copying, listing, and deleting models on your server

## List of Actions

### Generation

- Chat
- Generate Completion

### Embeddings

- Create Embeddings

### Model Management

- Copy Model
- Delete Model
- List Local Models
- List Running Models
- Pull Model
- Show Model Info

### Server

- Get Version

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| Server URL  | Yes      | Your Ollama server URL, e.g. `http://your-server:11434`. Must be reachable from FlowRunner. |
| API Key     | No       | Optional Bearer token if your server sits behind an authenticating reverse proxy. Sent as `Authorization: Bearer <token>`. |

## Exposing your Ollama server

FlowRunner runs in the cloud, so `http://localhost:11434` on your laptop is not reachable. Your
Ollama server needs a public (or VPN/tunnel-reachable) address:

1. **Bind to all interfaces.** By default Ollama listens on `127.0.0.1` only. Set
   `OLLAMA_HOST=0.0.0.0` in the server's environment (e.g. in
   `systemctl edit ollama` → `Environment="OLLAMA_HOST=0.0.0.0"`, then restart the service).
2. **Secure it.** Ollama has no built-in authentication. Do not expose port `11434` raw to the
   internet — put it behind a reverse proxy (nginx, Caddy, Traefik) that terminates TLS and
   requires an `Authorization: Bearer` token, and/or restrict access with a firewall to
   FlowRunner's egress IPs.
3. **Example: DigitalOcean droplet.** Create a GPU or CPU droplet, install Ollama
   (`curl -fsSL https://ollama.com/install.sh | sh`), set `OLLAMA_HOST=0.0.0.0`, pull a model
   (`ollama pull llama3.2:3b`), open only ports 80/443 in the firewall and proxy
   `https://ollama.example.com` → `localhost:11434` with nginx or Caddy adding a Bearer-token
   check. Use that HTTPS URL and token in the service configuration.

Tunnels (Cloudflare Tunnel, Tailscale Funnel, ngrok) are a quick alternative for development.

## Notes

- **Generate Completion** supports an optional system prompt, JSON mode or structured outputs
  (JSON schema), thinking control for reasoning models (`deepseek-r1`, `qwen3`, `gpt-oss`), raw
  model options (temperature, `num_ctx`, seed, stop sequences) and keep-alive control.
- **Chat** supports tool/function calling, vision models (pass base64 images on messages, or use
  the **Image URLs** parameter to have public images downloaded and attached to the last user
  message), JSON mode, structured outputs, and thinking control.
- **Create Embeddings** works with local embedding models (`nomic-embed-text`, `mxbai-embed-large`,
  `all-minilm`, …) and supports optional truncation and output dimensions.
- **Pull Model**: large models can take many minutes; the pull continues server-side if the action
  times out — re-run to confirm completion (interrupted pulls resume) or check List Local Models.
- All requests are sent with `stream: false`; responses arrive as a single JSON object.
- Timings in responses (`total_duration`, `eval_duration`, …) are in **nanoseconds**.
- Structured outputs: choose Format `JSON Schema` and supply the schema in **Format Schema**, or
  just provide the schema — it takes precedence over the Format dropdown.

## Agent Ideas

- Use **Ollama** "Create Embeddings" with a local embedding model to vectorize document chunks, then **Qdrant** "Upsert Points" (or **Pinecone** "Upsert Vectors") to store them for a private, self-hosted RAG knowledge base.
- Embed a user question with **Ollama** "Create Embeddings", run **Qdrant** "Query Points" to retrieve the most relevant passages, then pass them to **Ollama** "Chat" for a grounded, fully on-premise answer.
- After **Ollama** "Chat" extracts structured fields from an incoming message using JSON-schema output, use **Google Sheets** "Add Row" to log the result and **Slack** "Send Message To Channel" to alert the team.
