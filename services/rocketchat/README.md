# Rocket.Chat FlowRunner Extension

FlowRunner service for [Rocket.Chat](https://rocket.chat/), the open-source team communication platform. Post and manage messages, work with channels, private groups, and direct messages, administer users, and upload files — against your own self-hosted (or cloud) Rocket.Chat server. Authentication uses a Personal Access Token (User ID + Auth Token) sent as `X-User-Id` / `X-Auth-Token` headers.

## Ideal Use Cases

- Broadcast automated alerts, build notifications, or reports into a Rocket.Chat channel or DM
- Create channels or private groups and seed them with members as part of onboarding workflows
- Pin, star, or react to messages to triage and highlight important updates
- Provision, update, or look up user accounts on a self-hosted workspace
- Share generated files or documents into a room by URL

## List of Actions

### Messages

- Post Message
- Send Message
- Update Message
- Delete Message
- Get Channel Messages
- Pin Message
- Star Message
- React to Message

### Channels

- Create Channel
- Get Channel Info
- List Channels
- Archive Channel
- Delete Channel
- Invite User to Channel
- Kick User from Channel
- Set Channel Topic
- Set Channel Announcement

### Groups

- Create Group
- Get Group Info
- List Groups

### Direct Messages

- Create Direct Message
- Send Direct Message

### Users

- Get User Info
- Create User
- Get Me
- Set User Status
- Update User

### Files

- Upload File to Room

## List of Triggers

This service does not define any triggers.

## Authentication

Rocket.Chat is self-hosted, so you point the service at your own server and authenticate with a
**Personal Access Token (PAT)**. All requests are sent to `{serverUrl}/api/v1` with these headers:

- `X-Auth-Token: <authToken>`
- `X-User-Id: <userId>`

### Creating a Personal Access Token

1. In Rocket.Chat, open **My Account → Personal Access Tokens**.
2. Create a new token (you may enable "Ignore Two Factor Authentication" for automation).
3. Rocket.Chat displays both a **Token** and a **User ID** — copy both immediately, as the token
   is shown only once.

### Configuration

| Config item | Description                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------- |
| `serverUrl` | Your Rocket.Chat server URL, e.g. `https://chat.example.com`. Any trailing slash is stripped. |
| `userId`    | The **User ID** shown when creating the Personal Access Token.                                |
| `authToken` | The **Personal Access Token** itself.                                                         |

All three items are required. Use **Get Me** after configuring to confirm the server URL and
credentials are valid.

## Channels: name vs. room ID

Rocket.Chat identifies rooms in two ways, and the difference matters:

- A **channel name** (e.g. `general`) or a `#`-prefixed reference (`#general`) is human-friendly and
  accepted by _Post Message_ (via the `channel` field) and _Get Channel Info_ (via `roomName`).
- A **room ID** (`roomId`, e.g. `GENERAL`) is the stable internal identifier required by most
  management actions — history, updates, deletes, invites, topics, uploads, etc. _Send Message_
  always uses the room ID form.

Use **Get Channel Info** or the built-in channel picker (Get Channels Dictionary) to resolve a name
into its room ID when an action requires `roomId`. Channel and user pickers are backed by the
**Get Channels Dictionary** and **Get Users Dictionary** helpers.

## Notes

- Every Rocket.Chat response includes a `success` flag; the service raises an error carrying the
  server's `error`/`errorType` message when a request is unsuccessful.
- Administrative actions (creating users, deleting channels, etc.) require the token's owner to hold
  the corresponding Rocket.Chat permissions.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to read a list of new hires, then call **Rocket.Chat** "Create User" and "Create Group" to provision accounts and a private onboarding group for each
- When a **GitHub** or **Jenkins** build event is received, use **Rocket.Chat** "Post Message" to alert the engineering channel with the status and a link
- Use **OpenAI** "Create Chat Completion" to summarize a long document, then call **Rocket.Chat** "Send Direct Message" to deliver the summary to the requesting user by username
