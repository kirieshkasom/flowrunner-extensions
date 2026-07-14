# Discord FlowRunner Extension

FlowRunner integration for [Discord](https://discord.com) — send and manage messages, create channels and threads, react to messages, DM members, manage roles, and post through webhooks, all via the Discord REST API (v10) using a bot token.

## Ideal Use Cases

- Notify a team channel when an event fires in another system (new order, alert, form submission).
- Post rich embeds (release notes, dashboards, status updates) to announcement channels.
- Spin up per-topic threads automatically for incidents, support tickets, or discussions.
- Onboard members by assigning or removing roles based on external data.
- DM individual members with personalized reminders or notifications.
- Relay messages into channels the bot is not installed in via an incoming webhook URL.

## List of Actions

### Messages
- Add Reaction
- Delete Message
- Edit Message
- Get Message
- Get Messages
- Send Direct Message
- Send Message
- Send Message (Advanced)

### Channels
- Create Channel
- Create Thread
- Delete Channel
- List Channels

### Members & Roles
- Add Role To Member
- Get Guild Member
- List Guild Members
- List Roles
- Remove Role From Member

### Webhooks
- Send Webhook Message

## List of Triggers

This service does not define any triggers. Discord delivers real-time events over its websocket Gateway rather than HTTP webhooks. Use `Get Messages` with polling if you need event-driven behavior.

## Setup

### 1. Create a Discord application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. In your application, go to **Bot**.
3. Click **Reset Token** and copy the token — this is the **Bot Token** config value. Treat it as a secret; it is shown only once.

### 2. Enable privileged intents (for member operations)

Still on the **Bot** page, under **Privileged Gateway Intents**, enable **Server Members Intent**. Without it, `List Guild Members`, `Get Guild Member` searches, and the members dictionary will fail.

### 3. Invite the bot to your server

1. Go to **OAuth2 → URL Generator**.
2. Under **Scopes**, check `bot`.
3. Under **Bot Permissions**, select what the operations you plan to use require. A practical set:
   - View Channels, Send Messages, Send Messages in Threads
   - Embed Links, Read Message History, Add Reactions
   - Manage Messages (edit/delete others' messages)
   - Manage Channels (create/delete channels), Create Public Threads
   - Manage Roles (role assignment — the bot's highest role must sit **above** any role it assigns)
4. Copy the generated URL, open it in a browser, and invite the bot to your server.

Equivalent invite URL template (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=268577872
```

### 4. Get your server (guild) ID

1. In Discord, open **User Settings → Advanced** and enable **Developer Mode**.
2. Right-click your server name in the sidebar and choose **Copy Server ID** — this is the **Server (Guild) ID** config value.

## Configuration

| Config Item | Required | Description |
|---|---|---|
| Bot Token | Yes | From the Developer Portal (Bot → Token). The bot must be invited to your server with appropriate permissions. |
| Server (Guild) ID | Yes | Your server ID (Developer Mode → right-click server → Copy Server ID). Used for channel, member, and role operations. |

## Notes & limitations

- **Rate limits**: Discord enforces per-route and global rate limits. When a limit is hit, the service raises a clear error including the `retry_after` value returned by Discord.
- **No triggers**: Discord delivers real-time events (new messages, member joins, etc.) over its websocket Gateway, not HTTP webhooks, so this extension does not provide triggers. Use polling with `Get Messages`, or an interaction endpoint outside this service, if you need event-driven behavior.
- **DM restrictions**: bots can only DM users who share a server with them, and users may block DMs from server members.
- **Message limits**: content is capped at 2000 characters; embed titles at 256 and descriptions at 4096 characters.
- **Role hierarchy**: the bot can only assign or remove roles positioned below its own highest role.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires for a support request, use **Discord** "Create Thread" to open a triage thread and "Send Message" to post the email details for the team.
- Use **Google Sheets** "Get Rows" to pull a list of new signups, then call **Discord** "Add Role To Member" for each so onboarded users automatically receive the right server role.
- When a **Trello** "Create Card" represents a new incident, use **Discord** "Send Message (Advanced)" to post a rich embed with status and links into the incidents channel.
