# Microsoft Teams FlowRunner Extension

FlowRunner integration for [Microsoft Teams](https://www.microsoft.com/en-us/microsoft-teams) built on the
[Microsoft Graph API](https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview) (v1.0). It
lets flows list teams and channels, send and read channel messages, reply to threads, create and delete
channels, work with one-on-one and group chats, and inspect team membership — all on behalf of the connected
user (delegated permissions).

## Ideal Use Cases

- Post automated status updates, alerts, or approvals into a Teams channel from any workflow
- Route incoming leads, tickets, or form submissions into the right channel or direct chat
- Reply to an existing channel thread to keep conversations grouped
- Sync team and channel membership into another system, or gate automations on membership
- Read recent channel or chat messages to trigger downstream processing
- Provision channels on demand (e.g. a private channel per project) and clean them up afterwards

## List of Actions

### Teams

- List Teams
- List Team Members

### Channels

- List Channels
- Create Channel
- Delete Channel

### Channel Messages

- Send Channel Message
- Reply To Channel Message
- Get Channel Messages
- Get Channel Message

### Chats

- List Chats
- Send Chat Message
- Get Chat Messages
- Create One-On-One Chat

### User Information

- Get My Profile

Dynamic dropdowns are provided for teams, channels (dependent on the selected team), and chats (labeled by
topic or participant names).

## List of Triggers

This service does not define any triggers. Microsoft Graph change notifications (webhooks for new channel/chat
messages) require a publicly reachable notification URL that answers Graph's synchronous `validationToken`
handshake at subscription time, plus periodic subscription renewal. This is planned as future work.

## Authentication

The service uses OAuth2 (authorization code flow) against the Microsoft identity platform
(`login.microsoftonline.com/common`), so work/school accounts from any tenant can connect (subject to your app
registration's supported account types).

### Azure App Registration Setup

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) (or Azure Portal → Microsoft
   Entra ID).
2. Go to **App registrations** → **New registration**.
3. Give the app a name (e.g. `FlowRunner Teams Integration`).
4. Under **Supported account types**, choose **Accounts in any organizational directory** (required for the
   `/common` endpoint used by this service).
5. Under **Redirect URI**, select platform **Web** and enter the OAuth callback URL provided by FlowRunner
   when configuring this integration.
6. Register the app and copy the **Application (client) ID** — this is the `Client ID` config item.
7. Go to **Certificates & secrets** → **New client secret**, create a secret, and copy its **Value** — this
   is the `Client Secret` config item.
8. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** and add:
   - `offline_access`
   - `User.Read`
   - `Team.ReadBasic.All`
   - `Channel.ReadBasic.All`
   - `ChannelMessage.Send`
   - `ChannelMessage.Read.All`
   - `Chat.ReadWrite`
   - `ChatMessage.Send`
9. Optionally click **Grant admin consent** for your organization. `ChannelMessage.Read.All` requires admin
   consent in most tenants.

## Configuration

| Config Item   | Required | Description                                                     |
| ------------- | -------- | --------------------------------------------------------------- |
| Client ID     | Yes      | Application (client) ID of the Microsoft Entra app registration |
| Client Secret | Yes      | Client secret value of the Microsoft Entra app registration     |

## Notes and Limitations

- All operations run with delegated permissions — the connected user must be a member of the teams and chats
  they interact with.
- Microsoft Graph caps message listing at 50 items per page; use the returned `@odata.nextLink` via the
  `Next Page Link` parameter to page through results.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires with a support request, use **Microsoft Teams** "Send Channel Message" to alert the support channel and page the on-call engineer.
- Use **Google Sheets** "On New Row" to detect a new project entry, then call **Microsoft Teams** "Create Channel" to spin up a dedicated private channel and "Send Channel Message" to post the kickoff details.
- Use **Microsoft Teams** "Get Channel Messages" to pull the latest channel activity and **Slack** "Send Message To Channel" to mirror important updates into a Slack workspace.
