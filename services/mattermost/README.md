# Mattermost FlowRunner Extension

Integrate a self-hosted (or Cloud) [Mattermost](https://mattermost.com/) instance with FlowRunner.
Create and manage posts, channels, teams, users, files, and reactions through the Mattermost REST
API v4, using a Personal Access Token or bot token.

## Ideal Use Cases

- Post automated notifications, alerts, or reports to a Mattermost channel or thread.
- Provision channels and manage membership as part of onboarding or project workflows.
- Search and archive channel history for auditing or reporting.
- Sync files into Mattermost or pull attachments back into FlowRunner file storage.
- React to posts or manage user presence status programmatically.

## List of Actions

### Posts

- Create Post, Get Post, Update Post, Delete Post, Get Channel Posts, Search Posts, Pin Post, Unpin Post

### Channels

- Create Channel, Get Channel, Get Channel by Name, List Channels for Team, Delete Channel, Add User to Channel, Remove User from Channel, Create Direct Channel, Create Group Channel

### Teams

- List Teams, Get Team, Get Team by Name

### Users

- Get User, Get User by Username, Get Me, Search Users, Create User, Update User Status

### Files

- Upload File, Get File

### Reactions

- Add Reaction, Remove Reaction

## List of Triggers

This service does not define any triggers.

## Configuration

| Config Item    | Required | Description                                                                                                                                                     |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Server URL`   | Yes      | Your self-hosted Mattermost server base URL, e.g. `https://mattermost.example.com`. Any trailing slash is stripped automatically; the service calls `{Server URL}/api/v4`. |
| `Access Token` | Yes      | A Personal Access Token or bot token, sent as a Bearer token on every request.                                                                                  |

### Getting an Access Token

Mattermost is self-hosted, so you point the service at your own server via **Server URL**.

**Personal Access Token (per-user):**

1. An administrator must first enable personal access tokens: **System Console → Integrations →
   Integration Management → Enable Personal Access Tokens**.
2. In the app, open **Account Settings → Security → Personal Access Tokens → Create Token**.
3. Copy the generated token into the **Access Token** config item.

**Bot token (recommended for automation):**

1. **System Console → Integrations → Bot Accounts** — create a bot account.
2. Copy the bot's access token into the **Access Token** config item.
3. Add the bot to the teams and channels it needs to operate in.

The token is sent as `Authorization: Bearer <accessToken>` on every request. Actions are limited to
what the token's account is permitted to do (team/channel membership, admin permissions, etc.). Use
**Get Me** as a quick connection check to verify the Server URL and token are valid.

### Finding Team and Channel IDs

Many actions take a **Team ID** or **Channel ID**. In the FlowRunner UI these are backed by
dictionaries, so you can pick them from a list. You can also resolve them by handle with **Get Team
by Name** / **Get Channel by Name**, or find IDs in the channel's **View Info** dialog in the
Mattermost app.

## Notes

- **Upload File** requires a publicly reachable **File URL**; it downloads the file and forwards it
  to Mattermost, returning a file ID you attach to a message via **Create Post** → File IDs.
- **Get File** stores a downloaded Mattermost file in FlowRunner file storage and returns a URL.
- Mattermost errors surface as `Mattermost API error: <message> (<id>, status <status_code>)`.

## Agent Ideas

- Use **Mattermost** "Search Posts" to gather a team's discussion on a topic, then **Notion**
  "Create Page" to archive the summary into a knowledge base.
- When a **Slack** "On Channel Message" trigger fires, cross-post the message with **Mattermost**
  "Create Post" to mirror activity into a Mattermost channel.
- After **Google Sheets** "Get Rows" returns a list of stakeholders, call **Mattermost**
  "Create Channel" and "Add User to Channel" to spin up a project channel and enroll each member.
