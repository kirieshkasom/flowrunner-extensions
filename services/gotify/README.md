# Gotify FlowRunner Extension

Send and manage push notifications through a self-hosted [Gotify](https://gotify.net) server. Gotify is an open-source, self-hosted service for sending and receiving messages in real time, so this integration works against **your own** server rather than a shared cloud API. Deliver messages with titles, priorities (0-10), and client-specific extras (such as Markdown rendering), and read or manage messages, applications, and clients.

## Ideal Use Cases

- Push instant alerts to your phone or desktop when a workflow completes, fails, or crosses a threshold, using high priority so urgent notifications bypass client limits.
- Route Markdown-formatted status updates or reports to Gotify clients using message extras.
- Provision and maintain Gotify applications and clients programmatically, including uploading application icons.
- Audit or clean up notification history by listing and deleting messages across one or all applications.
- Health-check a self-hosted Gotify instance to confirm the server URL is reachable before sending.

## List of Actions

### Messages

- Create Message
- Get Messages
- Get Application Messages
- Delete Message
- Delete All Messages

### Applications

- Get Applications
- Create Application
- Update Application
- Delete Application
- Upload Application Image

### Clients

- Get Clients
- Create Client
- Delete Client

### System

- Get Health
- Get Version

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Server URL** | Yes | The base URL of your Gotify server, e.g. `https://gotify.example.com`. Strip any trailing slash. |
| **Application Token** | Yes | Token used to **send** messages. In Gotify, open **Apps**, create an application, and copy its token. |
| **Client Token** | No | Token used to **read and manage** messages, applications, and clients. In Gotify, open **Clients** and copy a client token. |

### App token vs. client token

Gotify uses two different token types, and this integration picks the correct one per operation. Both are sent via the `X-Gotify-Key` header:

- **Application token** authenticates **Create Message**. Each application has its own token, and messages sent with it belong to that application.
- **Client token** authenticates every read/management operation (Get Messages, Delete Message, application and client management, dictionaries).

Operations that need a client token fail with a clear error if the **Client Token** is left blank, so add one before using them.

**Get Health** and **Get Version** require no token and are handy for verifying that your **Server URL** is reachable.

### Priority levels

Gotify message priority ranges from **0 to 10**. Higher values are more prominent:

- **0-3** — low priority; typically shown quietly without a sound.
- **4-7** — normal priority; usually raises a standard notification.
- **8-10** — high priority; most prominent, and can bypass the client's notification limits.

If you omit a priority, Gotify applies the owning application's default priority.

### Extras example

The `extras` object on **Create Message** enables client-specific features. For example, render the message as Markdown:

```json
{ "client::display": { "contentType": "text/markdown" } }
```

Or make the notification open a URL when clicked:

```json
{ "client::notification": { "click": { "url": "https://example.com" } } }
```

## Agent Ideas

- When an **UptimeRobot** "Get Monitors" check reports a monitor as down, use **Gotify** "Create Message" with a high priority to push an urgent outage alert to your devices.
- After **Sentry** "List Issues" surfaces new unresolved errors, call **Gotify** "Create Message" to notify the on-call engineer with the issue title and count in Markdown.
- When a **Grafana** "Query Data Source" result crosses an alerting threshold, use **Gotify** "Create Message" to broadcast the metric breach to all subscribed clients.
