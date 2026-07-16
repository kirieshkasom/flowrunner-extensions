# Matrix FlowRunner Extension

Connect FlowRunner to a [Matrix](https://matrix.org/) homeserver via the Matrix
[Client-Server API](https://spec.matrix.org/latest/client-server-api/). Authenticate with a
homeserver URL and a Bearer access token to send messages and events, manage rooms and memberships,
read profiles, and move media in and out of the homeserver's media repository. Each send generates a
unique transaction ID automatically for idempotency.

## Ideal Use Cases

- Post automated notifications, alerts, or bot messages into Matrix rooms with plain-text or rich HTML formatting.
- Provision and administer rooms: create rooms, invite or kick members, and set names and topics as part of onboarding or event workflows.
- Archive or audit conversations by paging through a room's timeline and reading its state and membership.
- Bridge external files into Matrix by uploading media from a URL, or export attachments by downloading media into FlowRunner file storage.

## List of Actions

### Messaging

- Redact Event
- Send Event
- Send Message
- Send Notice

### Rooms

- Create Room
- Forget Room
- Get Joined Rooms
- Get Room Members
- Get Room Messages
- Get Room State
- Invite User
- Join Room
- Kick User
- Leave Room
- Resolve Room Alias
- Set Room Name
- Set Room Topic

### Profile

- Get Profile
- Set Display Name
- Whoami

### Media

- Download Media
- Upload Media

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item      | Required | Description                                                                                          |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------- |
| Homeserver URL   | Yes      | Your Matrix homeserver base URL, e.g. `https://matrix.org`. A trailing slash is trimmed automatically. |
| Access Token     | Yes      | An access token for your Matrix account.                                                             |

Requests authenticate with `Authorization: Bearer {accessToken}`. All Client-Server calls target
`{homeserverUrl}/_matrix/client/v3`; media calls target `{homeserverUrl}/_matrix/media/v3`.

### Getting an access token

- **Element client:** Settings → Help & About → Advanced → Access Token.
- **Via the API:** call `POST /_matrix/client/v3/login` with your credentials and read the
  `access_token` from the response.

Treat the access token like a password — it grants full API access to your account until logged out.

## How Matrix works

- **Rooms** are identified by a room ID like `!abc123:matrix.org`. Human-friendly **aliases** look
  like `#room:matrix.org`; use **Resolve Room Alias** (or **Join Room**, which accepts either) to
  turn an alias into a room ID.
- **Events** are the unit of everything in a room — messages, membership changes, topic/name
  changes, reactions, and custom types. **Send Message** and **Send Notice** send `m.room.message`
  events; **Send Event** sends any event type with a custom content object.
- **Transaction IDs (`txnId`)** provide idempotency for sends and redactions. This service
  generates a unique transaction ID automatically for every send/redact call, so retries do not
  create duplicates.
- **Media** is referenced by `mxc://serverName/mediaId` URIs. **Upload Media** fetches a source URL
  and stores it on the homeserver, returning an `mxc://` URI. **Download Media** takes the server
  name and media ID from an `mxc://` URI, retrieves the bytes, and saves them into FlowRunner file
  storage, returning a downloadable URL.

## Errors

Matrix errors are returned as `{ "errcode": "M_...", "error": "..." }` with an HTTP status. This
service surfaces both the error code and message, e.g. `Matrix API error [M_FORBIDDEN]: ...`.

## Agent Ideas

- When a **Slack** "On Channel Message" trigger fires, use **Matrix** "Send Message" to mirror the message into a Matrix room, keeping both communities in sync.
- Use **Discord** "Get Messages" to pull a channel's recent history, then call **Matrix** "Send Notice" to post a bot-formatted digest into a Matrix room.
- Fetch an attachment with **Matrix** "Download Media", then use **Discord** "Send Message" to forward the stored file link into a Discord channel.
