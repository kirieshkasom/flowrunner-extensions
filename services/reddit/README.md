# Reddit FlowRunner Extension

FlowRunner integration for [Reddit](https://www.reddit.com), acting on behalf of a connected Reddit user via OAuth2. Submit and edit posts and comments, vote, save and hide content, browse and search subreddits, manage subscriptions, and send private messages.

## Ideal Use Cases

- Cross-post announcements or content by submitting text or link posts to a subreddit as the connected user.
- Monitor a subreddit's Hot/New/Top listings or search results and route matching posts into another tool.
- Auto-reply to mentions or messages by reading the inbox and posting comments or private messages.
- Sync a user's saved items, karma breakdown, or subscriptions into a spreadsheet or database.
- Look up subreddit info and posting rules before publishing to stay compliant with community guidelines.

## List of Actions

### Identity

- Get Me
- Get My Karma
- Get My Subreddits

### Submissions

- Delete Post
- Edit Post
- Get Post
- Submit Post

### Comments

- Add Comment
- Delete Comment
- Edit Comment
- Get Comments For Post

### Voting & Saving

- Hide
- Save
- Unhide
- Unsave
- Vote

### Listings & Browse

- Get Subreddit Posts
- Get User Posts
- Search

### Subreddits

- Get Subreddit Info
- Get Subreddit Rules
- Subscribe Or Unsubscribe

### Messages

- Get Inbox
- Send Message

## Authentication

This service uses **OAuth2** (`@requireOAuth`). Create a **web app** at
<https://www.reddit.com/prefs/apps> and configure two shared config items:

| Config item     | Description                               |
| --------------- | ----------------------------------------- |
| `Client Id`     | The client ID of your Reddit web app.     |
| `Client Secret` | The client secret of your Reddit web app. |

The connection uses `duration=permanent`, so Reddit returns a **refresh token** that FlowRunner
uses to renew the short-lived access token automatically. If you re-register the app or revoke
access, reconnect the integration.

### OAuth scopes

The connection requests the following scopes (space-separated, per Reddit's spec):

```
identity read submit edit vote history mysubreddits subscribe save report privatemessages
```

## Important notes

- **User-Agent is mandatory.** Reddit blocks or rate-limits (HTTP 429) any request without a
  descriptive, unique `User-Agent` header. Every request this service makes sends
  `FlowRunner/1.0 (FlowRunner Reddit Integration)`.
- **API host.** Authenticated calls go to `https://oauth.reddit.com` (not `www.reddit.com`,
  which is only used for the authorize and token endpoints).
- **Fullnames.** Many actions take a Reddit *fullname* — a type prefix plus a base36 id:
  - `t1_` — comment (e.g. `t1_def456`)
  - `t3_` — post / link (e.g. `t3_abc123`)
  - `t4_` — private message
  - `t5_` — subreddit (e.g. `t5_2qh1o`)
- **Article ids vs fullnames.** "Get Post" and "Get Comments For Post" take the bare base36
  **article id** (the part of a post URL after `/comments/`, e.g. `abc123`), while edit/delete/vote
  actions take the full `t3_`/`t1_` fullname.
- **Listings.** Reddit wraps list results as
  `{ kind: "Listing", data: { children: [{ kind, data }], after, before } }`. Browse actions in
  this service unwrap that into `{ items: [...], after, before }`, where `after` is the cursor for
  the next page.
- **Write errors.** Reddit write endpoints (`api_type=json`) can return HTTP 200 with errors inside
  `json.errors` (an array of `[code, message, field]`). This service inspects that array and raises
  a real error so failures are not silently swallowed.

## Agent Ideas

- Use **Reddit** "Search" or "Get Subreddit Posts" to pull recent discussion on a topic, then **Anthropic Claude** "Ask Claude" to summarize sentiment and post the digest via **Slack** "Send Message To Channel".
- When new mentions or replies surface via **Reddit** "Get Inbox", use **Reddit** "Send Message" to respond and **Google Sheets** "Add Row" to log each conversation for follow-up.
- Take a write-up drafted in **Notion** "Create Page", then use **Reddit** "Submit Post" to publish it to a subreddit and "Add Comment" to seed the discussion thread.
