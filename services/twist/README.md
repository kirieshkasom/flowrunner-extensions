# Twist FlowRunner Extension

FlowRunner integration for [Twist](https://twist.com/), Doist's team communication app built around organized, threaded conversations. It uses OAuth 2 to manage workspaces, channels, threads, comments, and direct-message conversations following Twist's workspace → channel → thread → comment hierarchy.

## Ideal Use Cases

- Automatically start a thread or post a comment in a channel when an event happens in another system (a new ticket, deploy, or form submission).
- Create and organize channels for new projects or teams, then seed them with an initial thread.
- Notify specific members or everyone by adding threads, comments, or direct messages with mentions.
- Resolve conversations by closing threads once work is complete, and reopen them if follow-up is needed.
- Sync direct-message conversations or channel discussions into logs, dashboards, or spreadsheets.

## List of Actions

### Workspaces
- Get Workspaces
- Get Workspace
- Get Default Workspace

### Channels
- Get Channels
- Get Channel
- Add Channel
- Update Channel
- Archive Channel
- Remove Channel

### Threads
- Get Threads
- Get Thread
- Add Thread
- Update Thread
- Star Thread
- Move Thread
- Close Thread
- Reopen Thread
- Remove Thread

### Comments
- Get Comments
- Add Comment
- Update Comment
- Remove Comment

### Messages (Direct Messages)
- Get Conversations
- Get Conversation Messages
- Add Message

### Users
- Get Workspace Users
- Get Session User

## List of Triggers

This service does not define any triggers.

## Authentication

Twist uses **OAuth 2**. Before connecting, create an integration in Twist:

1. Go to [twist.com/integrations](https://twist.com/integrations) and create a new integration (General integration → OAuth 2).
2. Set the **OAuth 2 redirect URL** to the callback URL provided by FlowRunner.
3. Copy the generated **OAuth 2 client ID** and **OAuth 2 client secret**.
4. In FlowRunner, add these as the service's **Client ID** and **Client Secret** configuration items, then connect your account.

The integration requests these scopes: `user:read`, `workspaces:read`, `channels:read`, `channels:write`, `threads:read`, `threads:write`, `comments:read`, `comments:write`, `messages:read`, `messages:write`.

## Notes

### The Twist model

Twist is organized as a hierarchy:

- **Workspace** — the top-level container for an organization or team. Each user has a default workspace.
- **Channel** — groups related threads inside a workspace (like a topic or project). Channels can be public or private, and can be archived.
- **Thread** — a titled, focused discussion inside a channel.
- **Comment** — a reply on a thread.
- **Conversation / Message** — private direct messages between members, separate from channel threads.

A typical flow is: pick a **workspace** → choose or create a **channel** → start a **thread** → add **comments**.

### Content formatting

Thread, comment, and message **content** supports Twist markdown. Notable syntax:

- **Mentions:** `[Name](twist-mention://USER_ID)`
- **Group mentions:** `[Group name](twist-group-mention://GROUP_ID)`
- Standard markdown for bold, italics, lists, links, and code.

For **Recipients** on threads and comments, supply a comma-separated list of numeric user IDs (use **Get Workspace Users** to look them up), or the literal value `EVERYONE` to notify all participants.

### Dictionaries

Two dictionary methods power dependent parameter pickers: a workspaces picker, and a channels picker that depends on a selected workspace.

## Agent Ideas

- When a **Slack** "On Channel Message" trigger fires in a monitored channel, use **Twist** "Add Thread" to open an organized, titled discussion in the relevant workspace channel for follow-up.
- When **Linear** "Create Issue" produces a new bug or feature, use **Twist** "Add Comment" on the tracking thread (or "Add Message" to a conversation) to notify the responsible members with a `twist-mention` link.
- Use **Twist** "Get Conversation Messages" to pull a direct-message discussion, then call **Todoist** "Create Task" to turn each action item into a tracked to-do.
