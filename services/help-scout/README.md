# Help Scout FlowRunner Extension

FlowRunner integration for [Help Scout](https://www.helpscout.com/) — a customer support platform
built around shared mailboxes. This service wraps the
[Help Scout Mailbox API 2.0](https://developer.helpscout.com/mailbox-api/) and lets flows manage
conversations, threads, customers, mailboxes, users and tags.

## Ideal Use Cases

- Automatically create Help Scout conversations from inbound web forms, chat, or other channels.
- Triage support queues by assigning conversations, adding/removing tags, and updating status.
- Post automated replies or internal notes to conversations as part of a workflow.
- Sync customer records (create/update) from a CRM or signup flow.
- Report on mailboxes, folders, users, and tag usage for support analytics.

## Authentication

The service uses the Mailbox API's OAuth2 **client_credentials** flow, which works like an API key:
no user redirect is involved. The service exchanges your app credentials for an access token
(valid for about 2 days) and caches it, refreshing automatically shortly before expiry.

### Getting your credentials

1. Sign in to Help Scout.
2. Click your avatar (top right) → **Your Profile**.
3. Open the **My Apps** tab.
4. Click **Create My App**, give it a name (a Redirection URL is required by the form but is not
   used by this flow — any valid URL works, e.g. `https://example.com`).
5. Copy the **App ID** and **App Secret** into the service configuration.

| Config item | Description |
| ----------- | ----------- |
| App ID      | Help Scout OAuth2 application ID |
| App Secret  | Help Scout OAuth2 application secret |

Use the **Get Me** operation as a connection check — it returns the account owner profile when the
credentials are valid.

## List of Actions

### Conversations

- **Add Note** — add an internal note thread to a conversation.
- **Add Reply** — add a reply thread (sent to the customer; supports drafts).
- **Add Tags** — merge tags into a conversation, preserving the rest.
- **Assign Conversation** — assign to a user or unassign.
- **Create Conversation** — create a conversation in a mailbox with an initial customer message,
  reply, or internal note; optional tags and assignee.
- **Delete Conversation** — permanently delete a conversation.
- **Get Conversation** — fetch a conversation by ID, optionally embedding its threads.
- **List Conversations** — filter by mailbox, status, tag, modification date, or Help Scout's
  advanced search query syntax; paginated.
- **List Threads** — list all threads of a conversation.
- **Remove Tags** — remove tags from a conversation, preserving the rest.
- **Update Conversation** — change subject, status and/or assignee.

### Customers

- **Create Customer** — name, email, optional phone and organization.
- **Get Customer** — full profile with embedded contact entries.
- **List Customers** — filter by email, name or search query; paginated.
- **Update Customer** — update profile fields (name, job title, organization, location, background).

### Mailboxes

- **List Mailbox Folders** — folders of a mailbox with conversation counts.
- **List Mailboxes** — all mailboxes visible to the app.

### Users

- **Get Me** — account owner profile (connection check).
- **List Users** — team members, filterable by email or mailbox.

### Tags

- **List Tags** — all tags in the account with usage counts.

Dropdown parameters for mailboxes and users are populated dynamically via dictionaries.

## List of Triggers

This service does not define any triggers.

## Notes

- Help Scout responses use HAL (`_embedded` / `_links`); list operations return the unwrapped
  collection as `items` plus the `page` metadata object (`number`, `size`, `totalElements`,
  `totalPages`). Pass `page.number + 1` back as the Page parameter to iterate.
- Create operations (conversation, customer, reply, note) return the new resource — Help Scout
  reports the created ID via the `Resource-Id` response header, which the service resolves for you.

## Future work

- **Triggers (webhooks):** Help Scout webhooks require registering a callback URL together with a
  secret key used for HMAC-SHA1 signature verification (`X-HelpScout-Signature`). Realtime
  triggers for events such as `convo.created`, `convo.assigned` and `customer.created` can be
  added later using the standard REALTIME trigger handlers.

## Agent Ideas

- When an **Intercom** or **Zendesk** conversation needs escalation, use Help Scout **Create
  Conversation** to open a tracked support case in the right mailbox, then **Add Tags** to route it.
- Fetch new signups with **Google Sheets** "Get Rows", then call Help Scout **Create Customer**
  for each to keep the support platform's customer directory in sync.
- After Help Scout **Assign Conversation** or **Add Note**, use **Slack** "Send Message To Channel"
  to notify the assigned agent's team channel with the conversation link.
- Use Help Scout **List Conversations** to pull unresolved cases, then log a daily summary via
  **Google Sheets** "Add Row" or draft a digest with **Gmail** "Send Message".
