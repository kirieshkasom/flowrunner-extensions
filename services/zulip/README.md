# Zulip FlowRunner Extension

Connect FlowRunner to a Zulip organization to send stream and direct messages, manage streams (channels) and users, react to and edit messages, upload files, and register event queues. Authenticates with HTTP Basic auth using your Zulip email and API key against your organization's Site URL.

## Ideal Use Cases

- Post alerts, deploy notifications, or report summaries into a Zulip stream topic
- Send direct messages to individuals or groups from an automated workflow
- Add or remove emoji reactions to acknowledge or triage messages
- Upload files (logs, PDFs, images) and reference them in message content
- Provision, update, or deactivate organization members during onboarding/offboarding
- Look up streams, topics, and users to route messages dynamically

## List of Actions

### Messages

- Send Message
- Get Messages
- Update Message
- Delete Message
- Add Reaction
- Remove Reaction
- Get Message Read Receipts
- Upload File

### Streams

- Get Streams
- Get Stream ID
- Get Stream Topics
- Subscribe to Streams
- Create Stream
- Unsubscribe from Streams

### Users

- Get Users
- Get User
- Get Own User
- Create User
- Update User
- Deactivate User

### Events

- Register Event Queue

## List of Triggers

This service does not define any triggers.

## Configuration

- **Site URL** — Your Zulip organization URL, e.g. `https://yourorg.zulipchat.com` (trailing slash is stripped automatically).
- **Email** — The bot or user email address used for authentication.
- **API Key** — Zulip API key, found under Settings > Account & privacy > API key (or a bot's key).

The service authenticates every request with `Authorization: Basic base64("{email}:{apiKey}")` against the base URL `{siteUrl}/api/v1`.

## Notes

- Request bodies are form-encoded; array/object fields (Recipients, Narrow, Subscriptions) are JSON-stringified into their form fields automatically. Every response carries a `result` field; on error the service throws with the Zulip `msg`, `code`, and HTTP status.
- For a stream message set Type to "Stream", put the stream name in Recipients, and set a Topic; for a direct message set Type to "Direct" and pass Recipients as a JSON array of user emails or IDs (Topic is ignored).
- In Zulip, creating a stream is done by subscribing to a name that does not yet exist. A Get Streams dictionary provides a searchable stream picker for dependent parameters.
- Upload File stores the file in FlowRunner file storage and returns both the Zulip upload URL and a downloadable FlowRunner URL; reference the Zulip URL as a Markdown link in message content. Files 25MB+ may fail on network timeouts.
- Get Own User doubles as a quick connection check. Create/Update/Deactivate User require Zulip administrator permissions.
- Register Event Queue creates a Zulip event queue; fetching events uses long-polling and is intentionally not exposed as an operation.

## Agent Ideas

- Use **Zulip** "Get Streams" to resolve the target channel, then **Zulip** "Send Message" to post a formatted status update to its topic
- When a **Slack** "On Channel Message" trigger fires, use **Zulip** "Send Message" to mirror the message into a Zulip stream so both teams stay in sync
- Fetch new rows with **Google Sheets** "Get Rows", then call **Zulip** "Create User" for each entry to onboard members into the organization
- Use **Zulip** "Upload File" to store a generated report, then **Gmail** "Send Message" to email the downloadable FlowRunner link to stakeholders
