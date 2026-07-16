# Cisco Webex FlowRunner Extension

Integrate [Cisco Webex](https://developer.webex.com) messaging, spaces, memberships, people, teams, meetings, and webhooks into FlowRunner. Post messages to spaces or people, manage spaces and their members, look up people, schedule meetings, and manage Webex-side webhooks.

## Ideal Use Cases

- Post automated notifications, alerts, or reports into a Webex space or as a direct message to a person
- Provision and manage spaces — create rooms, add or remove members, and archive spaces as projects start and end
- Schedule, update, and cancel Webex meetings from a workflow and share the join link with invitees
- Look up people in your organization by email or name to route messages and memberships correctly
- Download files attached to messages into FlowRunner storage for further processing
- Register and manage Webex-side webhooks that push events to an endpoint you host

## List of Actions

- **Messages** — Create Message, Create Direct Message, List Messages, Get Message, Delete Message, Get Message Attachment
- **Rooms** — List Rooms, Create Room, Get Room, Update Room, Delete Room, Get Room Meeting Details
- **Memberships** — List Memberships, Create Membership, Delete Membership
- **People** — Get My Own Details, List People, Get Person
- **Teams** — List Teams, Create Team, Get Team, List Team Memberships
- **Meetings** — List Meetings, Create Meeting, Get Meeting, Update Meeting, Delete Meeting
- **Webhooks** — List Webhooks, Create Webhook, Delete Webhook

**Get My Own Details** is a handy connection check — it returns the identity (person or bot) behind the token.

## List of Triggers

This service does not define any triggers. See **Webhooks** below for managing Webex-side webhooks that you host and handle yourself.

## Authentication

This service uses a single **Access Token** sent as `Authorization: Bearer <accessToken>` against `https://webexapis.com/v1`.

Get a token from [developer.webex.com](https://developer.webex.com):

- **Bot token (recommended for production):** create a Bot at *My Webex Apps → Create a Bot*. The token is long-lived and posts as the bot identity. The bot must be added to a space before it can read or post there.
- **Personal Access Token:** available on the developer portal for testing only. It carries your full user permissions but **expires after 12 hours** — do not use it in production.
- **Integration (OAuth) token:** for production apps acting on behalf of a user, mint an access token via a Webex Integration and paste it here.

Whichever token you use, its scopes/permissions determine which operations succeed.

## Spaces, Rooms, and IDs

In the Webex API a "space" is called a **room**. Most operations take a **Room ID**. Use the built-in **Get Rooms Dictionary** to pick a room by title instead of pasting an ID. **List Rooms** can filter by type: `direct` (1:1 conversations) or `group` (multi-person spaces).

- **Bots only see spaces they are a member of.** Add the bot to a space (or use **Create Membership**) before listing or posting.
- **Create Message** is the primary action: send to a space (Room ID) **or** a person (`toPersonEmail` / `toPersonId`) — provide exactly one destination. Supply `text` and/or `markdown`, plus optional public file URLs and Adaptive Card attachments.
- **Create Direct Message** is a shortcut for messaging one person by email.

## Meetings

**Create Meeting** schedules a Webex meeting. `start` and `end` are ISO 8601 timestamps (e.g. `2026-07-15T15:00:00Z`); set `timezone` to an IANA zone (e.g. `America/New_York`) when your times are local. Invitees is a list of email addresses. The response includes the `meetingNumber`, `webLink`, and `sipAddress` used to join. **Update Meeting** requires title/start/end on every call, so pass the current values for fields you are not changing.

## Attachments

When a message has files, its `files` array contains Webex content URLs (`https://webexapis.com/v1/contents/...`). **Get Message Attachment** downloads that URL with your token and stores the file in FlowRunner file storage, returning a shareable URL. Choose the storage scope (`FLOW`, `WORKSPACE`, or `EXECUTION`) via the File Settings parameter.

## Webhooks

The **Webhooks** operations (List / Create / Delete) manage **Webex-side** webhooks that POST event payloads to a target URL you own. They are provided for management/automation — this service does **not** register them as FlowRunner triggers, so you must host and handle the callback endpoint yourself. Optionally set a `secret` to verify the `X-Spark-Signature` HMAC on incoming payloads.

## Errors

Webex errors surface the API `message`, any `errors[].description`, and the **trackingId**. Include the trackingId when contacting Webex support — they use it to trace the failing request.

## Agent Ideas

- When a **Google Calendar** "On Event Starting Soon" trigger fires, use **Cisco Webex** "Create Meeting" to spin up a Webex session and "Create Direct Message" to send each attendee the `webLink`.
- Use **Cisco Webex** "List People" to resolve a coworker's email to a person ID, then "Create Membership" to add them to a project space created with "Create Room".
- Use **Cisco Webex** "List Messages" and "Get Message Attachment" to pull files posted in a space, then relay a summary into a **Microsoft Teams** channel via "Send Channel Message".
