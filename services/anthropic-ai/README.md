# Anthropic Claude FlowRunner Extension

FlowRunner integration for the [Anthropic Claude API](https://platform.claude.com/docs). Covers the full current API surface: the Messages API (text, vision, PDFs with citations, tool use, structured JSON output, thinking and effort controls), token counting, Message Batches, the Files API, model discovery, and Managed Agents (beta) - server-managed stateful agents with sandboxed tool execution, driven asynchronously via sessions, events, and an On Session Idle polling trigger. Authenticate with an Anthropic API key.

## Ideal Use Cases

- Generating, summarizing, rewriting, or classifying text inside a flow with a single prompt
- Building multi-turn assistants with tool use (function calling) and schema-enforced structured JSON output
- Extracting information from images, PDFs, and documents, with optional citations to the source passages
- Processing large workloads asynchronously and cheaply with Message Batches
- Estimating cost or validating context-window fit by counting input tokens before sending
- Running long, autonomous agent tasks (research, coding, document production) with Managed Agents: create a session, send the task or a rubric-graded outcome, let the On Session Idle trigger fire when the agent finishes, then read the answer and download output files

## List of Actions

### Messages

- Analyze Document
- Analyze Image
- Ask Claude
- Count Tokens
- Send Messages

### Message Batches

- Cancel Message Batch
- Create Message Batch
- Get Message Batch
- Get Message Batch Results
- List Message Batches

### Files

- Delete File
- Download File
- Get File Metadata
- List Files
- Upload File

### Models

- Get Model
- List Models

### Agents

- Archive Agent
- Create Agent
- Get Agent
- List Agent Versions
- List Agents
- Update Agent

### Agent Environments

- Create Environment
- Delete Environment
- Get Environment
- List Environments

### Agent Sessions

- Archive Session
- Create Session
- Delete Session
- Get Session
- Get Session Result
- List Session Output Files
- List Sessions

### Agent Session Events

- Define Outcome
- Get Session Events
- Interrupt Session
- Send Custom Tool Result
- Send Message To Session
- Send Tool Confirmation

## List of Triggers

- On Session Idle - polling trigger that fires when a Managed Agents session transitions into the `idle` or `terminated` status (i.e. the agent finished working or is waiting for input), optionally filtered by session title.

## Configuration

| Config Item | Required | Description |
|---|---|---|
| API Key | Yes | Your Anthropic API key from https://platform.claude.com/settings/keys |

All requests are sent with the `x-api-key` and `anthropic-version: 2023-06-01` headers. Files API operations additionally send the `anthropic-beta: files-api-2025-04-14` header, Managed Agents operations send `anthropic-beta: managed-agents-2026-04-01`, and List Session Output Files sends both beta headers comma-joined.

## Notes

- Default model is `claude-opus-4-8`. Model parameters use a live Models dictionary loaded from `GET /v1/models`, so newly released models appear automatically.
- Sampling parameters (`temperature`, `top_p`, `top_k`) and fixed thinking budgets are rejected by Claude Opus 4.7+ and Fable models — use Adaptive thinking and the Effort parameter on those models. Parameter descriptions in the UI call this out.
- Structured output uses `output_config.format` with a JSON schema; all object schemas must set `additionalProperties: false`.
- Only files created by Claude (via skills or the code execution tool, marked downloadable in their metadata) can be downloaded from the Files API; uploaded files are reference-only. Session output files listed via List Session Output Files are downloadable with the Download File action.
- Managed Agents is integrated as an asynchronous workflow (FlowRunner actions are single-shot): Create Agent and Create Environment once, then per run - Create Session, Send Message To Session (or Define Outcome for a rubric-graded loop), wait for the On Session Idle trigger, and read the answer with Get Session Result.
- Archive Agent is permanent: there is no unarchive and agents have no delete, so new sessions can never reference an archived agent again.

## Agent Ideas

- Use **Gmail** "On New Email" to detect an incoming support request, then **Ask Claude** to draft a reply and **Gmail** "Send Message" to send it back to the customer.
- Use **Google Drive** to fetch a PDF, pass it to **Analyze Document** with citations enabled, and record the extracted summary and source passages with **Notion** "Create Page".
- When new form responses land in a spreadsheet via **Google Sheets** "Get Rows", run each through **Send Messages** with schema-enforced structured JSON output to classify sentiment, then post a digest to **Slack** "Send Message To Channel".
