# DeepSeek FlowRunner Extension

FlowRunner integration for the [DeepSeek API](https://api-docs.deepseek.com) — fast, low-cost large language models with built-in extended reasoning ("thinking mode"), tool/function calling, JSON and structured output, prefix and fill-in-the-middle completions, and automatic context caching.

## Ideal Use Cases

- Generate, summarize, classify, or rewrite text with a low-cost model that has a 1M-token context window.
- Run multi-turn conversations with tool/function calling and structured JSON output.
- Force constrained output (pure code blocks, JSON) using prefix completion.
- Fill-in-the-middle code completion when the text before and after the insertion point are known.
- Monitor account balance before running large batches of API calls.

## List of Actions

### Chat
- Chat Completion
- Chat Completion (Advanced)
- Chat Prefix Completion

### Completions
- FIM Completion

### Models
- List Models

### Account
- Get Balance

## List of Triggers

This service does not define any triggers.

## Authentication

The service uses an API key (Bearer token).

| Config Item | Required | Description |
|-------------|----------|-------------|
| API Key     | Yes      | Your DeepSeek API key from https://platform.deepseek.com/api_keys |

## Models

| Model | Context | Max Output | Notes |
|-------|---------|------------|-------|
| `deepseek-v4-flash` | 1M tokens | 384K tokens | Default; thinking mode on by default |
| `deepseek-v4-pro`   | 1M tokens | 384K tokens | Most capable; required for FIM completion |

Legacy model names `deepseek-chat` and `deepseek-reasoner` are deprecated as of 2026-07-24 — they mapped to the non-thinking and thinking modes of `deepseek-v4-flash`, respectively. The **Get Models Dictionary** provides a live, searchable model list backing the Model parameters.

## Notes

- Context caching is automatic; usage responses include `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`.
- `frequency_penalty` and `presence_penalty` are deprecated by DeepSeek and are not exposed.
- Sampling parameters (temperature/top_p) may be ignored while thinking mode is active.
- Prefix and FIM completions use DeepSeek's beta endpoint; FIM is supported only by `deepseek-v4-pro` and runs in non-thinking mode.

## Agent Ideas

- When Gmail's "On New Email" trigger fires, use DeepSeek's "Chat Completion" to summarize or classify the message, then Slack's "Send Message To Channel" to post the summary to the team.
- Use Dropbox's "On New File" trigger and "Get Temporary Link" to fetch source code, run DeepSeek's "FIM Completion" or "Chat Completion" to generate or complete it, then Notion's "Create Page" to store the result.
- Read data with Google Sheets' "Get Rows", run DeepSeek's "Chat Completion (Advanced)" with structured JSON output to extract or enrich fields, then write results back with Google Sheets' "Add Row".
