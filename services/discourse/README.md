# Discourse FlowRunner Extension

Connect FlowRunner to a [Discourse](https://www.discourse.org/) forum to create and manage topics and posts, search content, manage users and private messages, and browse categories and tags. Authentication uses `Api-Key` and `Api-Username` headers against your forum's REST API.

## Ideal Use Cases

- Automatically open a support topic when a ticket arrives elsewhere, then post replies as the conversation progresses.
- Cross-post announcements or content from a CMS, spreadsheet, or chat tool into a specific forum category.
- Search the forum to find existing discussions and deduplicate before creating a new topic.
- Provision, look up, and moderate community members (create, suspend, map by external SSO ID).
- Send onboarding or notification private messages to one or more users.

## List of Actions

### Topics & Posts

- Create Topic
- Create Post / Reply
- Get Topic
- Get Post
- Update Post
- Delete Post
- Delete Topic
- List Latest Topics
- List Top Topics

### Categories

- List Categories
- Get Category Topics

### Search

- Search

### Users

- Create User
- Get User
- Get User by External ID
- List User Actions
- Suspend User

### Private Messages

- Send Private Message

### Tags

- List Tags

## List of Triggers

This service does not define any triggers.

## Authentication

This service authenticates with a Discourse **API key** rather than a user session. Every request sends two headers:

- `Api-Key` — the key generated in your forum's admin panel.
- `Api-Username` — the username the key acts on behalf of (e.g. `system` or an admin account).

| Config item | Required | Description |
| --- | --- | --- |
| **Site URL** | Yes | Your forum's base URL, e.g. `https://forum.example.com`. Any trailing slash is stripped; all requests are relative to this URL. |
| **API Key** | Yes | Generate under **Admin → API → Keys → generate a key**. Sent as the `Api-Key` header. |
| **API Username** | Yes | The username the key acts as (e.g. `system` or an admin). Sent as the `Api-Username` header. |

A global/admin key is required for admin operations such as **Create User** (with `active`/`approved`) and **Suspend User**.

## Notes

- **Topics vs posts.** Discourse organizes content as topics (threads) made of posts; a topic's first post is its opening message. **Create Topic** returns the new `topic_id`/`topic_slug`; pass that `topic_id` to **Create Post / Reply**, optionally with `reply_to_post_number` for a threaded reply. Post bodies are raw Markdown. Deleting the first post of a topic deletes the whole topic.
- **Categories are numeric IDs, not names.** **Create Topic** takes a numeric `category` ID — use **List Categories** (or the built-in categories picker) to look one up. **Get Category Topics** needs both the `slug` and numeric `id`, since Discourse addresses categories as `/c/{slug}/{id}`.
- **One endpoint, three actions.** Create Topic, Create Post / Reply, and Send Private Message all map to `POST /posts.json`; the supplied fields determine the outcome (title + category → topic, topic_id → reply, target usernames → PM).
- **Errors.** Validation failures return HTTP `422`; the service surfaces the joined messages with the status, e.g. `Discourse API error (422): Title is too short`. Zero-dependency service built on `Flowrunner.Request`.

## Agent Ideas

- Use **Discourse** "Search" to check whether a question already has a thread, and if not call **Discourse** "Create Topic", then post the answer with **Discourse** "Create Post / Reply".
- When a new row appears in **Google Sheets** ("Get Rows"), call **Discourse** "Create Topic" to publish it as a forum announcement in the target category.
- After **Discourse** "Create Topic" succeeds, use **Slack** "Send Message To Channel" to notify the community team with the new topic link.
- When onboarding a member, use **Discourse** "Create User" then **Discourse** "Send Private Message" to deliver a welcome, and log the account with **Notion** "Create Page".
