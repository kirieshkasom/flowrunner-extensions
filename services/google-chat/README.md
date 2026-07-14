# Google Chat FlowRunner Extension

FlowRunner integration for [Google Chat](https://chat.google.com) — send and manage messages,
create and configure spaces, and manage space memberships through the
[Google Chat API](https://developers.google.com/workspace/chat/api/reference/rest) using the
connected user's Google account (OAuth 2.0).

## Ideal Use Cases

- Post automated notifications, alerts, or status updates into Google Chat spaces as the connected user.
- Send rich interactive card messages (cardsV2) with headers, buttons, and images from a workflow.
- Create and set up new spaces with an initial member list for onboarding or project kickoff.
- Manage space membership by adding or removing users programmatically.
- Post to spaces the user is not a member of via an incoming-webhook URL under a bot identity.
- Retrieve, update, delete, and list messages to build chat-driven automations.

## List of Actions

### Spaces

- Create Space
- Get Space
- List Spaces
- Set Up Space

### Messages

- Delete Message
- Get Message
- List Messages
- Send Card Message
- Send Message
- Send Webhook Message
- Update Message

### Members

- Add Member
- List Members
- Remove Member

## List of Triggers

This service does not define any triggers.

## Authentication & Setup (Google Cloud Console)

This service uses OAuth 2.0 **user authentication**. You need a Google Cloud project with the
Chat API enabled and an OAuth client:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Enable the **Google Chat API**: APIs & Services > Library > "Google Chat API" > Enable.
3. **Configure the Chat app**: the Google Chat API requires a Chat app configuration even for
   user-authenticated API calls. Go to APIs & Services > Google Chat API > **Configuration**,
   fill in the app name, avatar URL, and description, and save. Without this configuration,
   some API calls may be rejected.
4. Configure the **OAuth consent screen** (APIs & Services > OAuth consent screen) and add the
   scopes listed below. While the app is in "Testing" publishing status, add your users as test
   users; refresh tokens for testing apps expire after 7 days unless the app is published.
5. Create an **OAuth client ID** (APIs & Services > Credentials > Create Credentials >
   OAuth client ID, type "Web application") and add FlowRunner's OAuth redirect URI to the
   authorized redirect URIs.
6. Copy the **Client ID** and **Client Secret** into the service configuration in FlowRunner.

### Required OAuth scopes

- `https://www.googleapis.com/auth/chat.messages`
- `https://www.googleapis.com/auth/chat.spaces`
- `https://www.googleapis.com/auth/chat.memberships`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

## Configuration

| Item          | Description                                            | Shared |
| ------------- | ------------------------------------------------------ | ------ |
| Client Id     | OAuth 2.0 Client ID from the Google Cloud Console.     | Yes    |
| Client Secret | OAuth 2.0 Client Secret from the Google Cloud Console. | Yes    |

A **Get Spaces Dictionary** provides dynamic space selection (label: display name, value:
`spaces/{space}` resource name) for all space parameters.

## Important limitations

- **User-scoped access**: with user OAuth, the service acts as the connected user. It can only
  message and manage spaces the user is a member of — it cannot post into arbitrary spaces the
  way a Chat bot can.
- **Bot-style posting via webhooks**: for spaces the connected user is not in (or to post under
  a bot identity), use the **Send Webhook Message** operation. Create an incoming webhook in the
  target space (space settings > *Apps & integrations* > *Webhooks*), copy the webhook URL, and
  pass it as the `Webhook URL` parameter. This path does not use the OAuth connection at all.
- Group chats and direct messages appear in **List Spaces** only after the first message has
  been sent in them.
- **Update Message** and **Delete Message** apply to messages the connected user is allowed to
  modify (own messages, or others' messages when the user is a space manager, per Chat rules).

## Notes

- Message resource names look like `spaces/{space}/messages/{message}` and are returned in the
  `name` field of send/list results — pass them to Get/Update/Delete Message.
- Threading: provide a `Thread Key` (caller-defined) or `Thread Name`
  (`spaces/{space}/threads/{thread}`) plus a Reply Option on **Send Message** to reply within an
  existing thread.
- Card messages use the standard
  [cardsV2 JSON format](https://developers.google.com/workspace/chat/api/reference/rest/v1/cards);
  a bare card object is wrapped automatically.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires for a support inbox, use **Google Chat** "Send Message" to notify the team space with the sender and subject.
- Use **Google Sheets** "Get Rows" to read a roster of new hires, then call **Google Chat** "Set Up Space" to create an onboarding space and add each person as a member.
- When a **Slack** "On Channel Message" trigger fires, use **Google Chat** "Send Card Message" to cross-post a formatted summary card into a Google Chat space.
- Post the outcome of a workflow with **Google Chat** "Send Message", then use **Google Sheets** "Add Row" to log the message resource name and timestamp for auditing.
