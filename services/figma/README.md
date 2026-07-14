# Figma FlowRunner Extension

Integrate [Figma](https://www.figma.com) with FlowRunner. This service wraps the Figma REST API to read files, export images, manage comments and reactions, browse teams/projects, inspect components and styles, view version history, and manage webhook subscriptions.

Figma's public API is predominantly **read-only** for design data — you can retrieve the document tree, render nodes to images, and read components/styles, but you **cannot create or edit design nodes** through the REST API. The write operations exposed here are limited to comments, comment reactions, and webhook subscriptions.

## Ideal Use Cases

- Export selected frames or components to PNG/JPG/SVG/PDF and archive durable copies for release notes, changelogs, or asset pipelines.
- Sync design system inventory (components, component sets, styles) from a team or file into external documentation or tracking tools.
- Notify a chat channel or log a spreadsheet row whenever a new file version is published or a comment is posted.
- Automate design-review workflows by reading comments, posting replies, and adding reactions programmatically.
- Inspect a file's document tree or specific nodes to feed design tokens and metadata into downstream automations.

## List of Actions

### Files
- Get File
- Get File Metadata
- Get File Nodes
- Get File Versions

### Images
- Export Image
- Get Image Fills

### Comments
- Add Comment Reaction
- Delete Comment
- Get Comment Reactions
- Get Comments
- Post Comment

### Projects
- Get Project Files
- Get Team Projects

### Components & Styles
- Get Component
- Get File Components
- Get File Styles
- Get Team Component Sets
- Get Team Components
- Get Team Styles

### User
- Get Me

### Webhooks
- Create Webhook
- Delete Webhook
- List Webhooks

## Authentication

This service authenticates with a **Figma personal access token**, sent on every request as the `X-Figma-Token` header (Figma uses this header for personal tokens rather than a Bearer token).

1. In Figma, open **Settings → Security → Personal access tokens**.
2. Click **Generate new token**, give it a name, and grant the scopes you need (e.g. file content read, comments, projects, library assets).
3. Copy the token (shown only once) and paste it into the service's **Access Token** config item.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| Access Token | Yes | Your Figma personal access token, sent as the `X-Figma-Token` header. |

## Finding File Keys and Team IDs from URLs

Most operations need a **file key** or a **team ID**. You can paste the full Figma URL — the service extracts the identifier automatically — or provide the bare identifier.

- **File key** — from a file/design URL:
  `https://www.figma.com/design/{fileKey}/My-File` → `{fileKey}`
  (also works for `/file/`, `/proto/`, `/board/`, and `/slides/` URLs)
- **Team ID** — from a team URL:
  `https://www.figma.com/files/team/{teamId}/My-Team` → `{teamId}`
- **Node IDs** — appear in the URL as `node-id=1-23` when a layer is selected; supply them as `1:23`.

## Notes

- **Read-only design data:** the API can read the document tree, render nodes to images, and read components/styles, but cannot create or edit design nodes. Writes are limited to comments, comment reactions, and webhook subscriptions.
- **Webhooks (v2 API):** the webhook operations only **manage** Figma webhook subscriptions. Figma delivers events to a stable, passcode-verified HTTPS endpoint that you must host and secure yourself. Delivery is **not** wired to a FlowRunner trigger by this service.
- Exported image URLs from Figma are temporary (roughly 30 days). Enable **Save To Storage** on Export Image for durable, FlowRunner-hosted copies.
- `Flowrunner.Request` returns the response body directly. Errors surface Figma's `err`/`message` field along with the HTTP status.

## Agent Ideas

- Use **Figma** "Export Image" to render selected frames to PNG, then **Notion** "Create Page" to publish a design handoff page embedding the exported assets and file metadata.
- After **Figma** "Get File Versions" reveals a new published version, use **Slack** "Send Message To Channel" to notify the design team with the version label and author.
- Use **Figma** "Get Team Components" to inventory a team's design system, then **Google Sheets** "Add Row" to log each component's name, key, and containing file into a tracking spreadsheet.
