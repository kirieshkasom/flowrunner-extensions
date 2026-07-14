# Perplexity FlowRunner Extension

FlowRunner integration for the [Perplexity API](https://docs.perplexity.ai) — web-grounded AI answers (Sonar), the standalone Search API, the Agent API with built-in research tools, and Perplexity's embedding models. Authenticates with a single API key (Bearer).

## Ideal Use Cases

- Answer questions with up-to-date, cited information pulled from the live web, academic papers, or SEC filings
- Run standalone web searches (ranked results, no LLM answer) to feed downstream automations or RAG pipelines
- Kick off long-running "Sonar Deep Research" jobs asynchronously and poll for the completed report
- Orchestrate frontier models (Sonar, OpenAI, Anthropic, Google, xAI) with built-in tools (web/finance/people search, URL fetch, code sandbox) via the Agent API
- Generate vector embeddings — including document-aware contextual embeddings — for semantic search and retrieval

## List of Actions

### Sonar

- Ask
- Chat Completion (Advanced)

### Search

- Search the Web

### Async Sonar

- Create Async Chat Completion
- Get Async Chat Completion
- List Async Chat Completions

### Agent

- Create Agent Response
- Get Agent Response

### Models

- List Models

### Embeddings

- Create Contextualized Embeddings
- Create Embeddings

## List of Triggers

This service does not define any triggers.

## Configuration

| Config Item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Your Perplexity API key. Create one at https://www.perplexity.ai/account/api/keys |

## Notes

- Base URL: `https://api.perplexity.ai`. No npm dependencies.
- Sonar chat endpoints use the fixed model set `sonar`, `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research`; the Agent API model picker is backed by a live models dictionary.
- Async results are retained for 7 days — poll **Get Async Chat Completion** until `status` is `COMPLETED`, then read the `response` property.
- Streaming (`stream: true`) is not exposed; FlowRunner actions return complete responses.

## Agent Ideas

- Use Perplexity "Ask" (or "Create Async Chat Completion" for Sonar Deep Research) to produce a cited market or competitor brief, then **Notion** "Create Page" to publish it as a research doc
- On a schedule, use Perplexity "Search the Web" with recency filters to gather the latest articles on a topic and **Google Sheets** "Add Row" to log each result with its title, URL, and date
- Use **Google Sheets** "Get Rows" to pull a list of companies, call Perplexity "Create Agent Response" with finance/people search to enrich each one, then **Slack** "Send Message To Channel" to post the summary to the team
