# Disqus FlowRunner Extension

Integrate with the [Disqus API 3.0](https://disqus.com/api/docs/) to read and manage forums, threads, posts (comments), and users on the Disqus commenting platform: list and moderate comments, create threads and posts, open/close discussions, and look up user activity. Authenticates with your Disqus application Public Key (API Key) plus an OAuth Access Token; write and moderation actions require a valid access token.

## Ideal Use Cases

- Build a moderation dashboard that pulls a queue of pending comments and approves, removes, or marks them as spam
- Automatically create a Disqus thread for each new page or article published on your site
- Export a forum's comment activity or a specific user's post history for auditing and analytics
- Cross-post comments or notify your team when new discussions or replies arrive

## List of Actions

### Forums

- Get Forum Details
- List Forum Categories
- List Forum Threads
- List Forum Posts

### Threads

- Get Thread Details
- List Thread Posts
- Create Thread
- Close Thread
- Open Thread

### Posts

- Get Post
- List Posts
- Create Post
- Approve Post
- Remove Post
- Mark Post As Spam
- Highlight Post

### Users

- Get User Details
- List User Posts

## List of Triggers

This service does not define any triggers.

## Authentication

Disqus authenticates each request with two query parameters that this service appends automatically:

- **API Key** — your Disqus application's **Public Key**. Create an application at [disqus.com/api/applications](https://disqus.com/api/applications/) and copy its Public Key. Sent as `api_key` on every request.
- **Access Token** — an OAuth **access token** for the account acting on the API, sent as `access_token`. Required for all write actions (creating threads/posts, approving, removing, marking spam, highlighting, opening/closing threads) and for private reads. Public read-only endpoints may work with only the Public Key, but supplying the access token is recommended.

Both config items are stored per connection (not shared).

## Notes

- Every Disqus response is wrapped in a `{ "code": 0, "response": { ... } }` envelope. `code: 0` means success — the service unwraps `response` and returns it directly; a non-zero code (or HTTP error) throws `Disqus API error (code N): <message>`.
- **Forums** are identified by their **short name** (the ID in your admin URL). **Threads** are identified by a numeric **thread ID** or resolved by **forum + link** (the page URL). **Posts** are identified by a numeric **post ID** and carry a moderation state. **Users** are identified by a numeric **user ID**.
- List endpoints accept `limit` (1-100, default 25) and a `cursor` for pagination; pass the previous response's `cursor.next` value to fetch the next page.
- Moderation-state dropdowns present friendly labels (e.g. `Approved`, `Unapproved`) that the service maps to the API's lowercase tokens.
- Write and moderation actions require an access token whose account has permission on the target forum.

## Agent Ideas

- Use **Disqus** "List Posts" to pull the moderation queue, then send each pending comment to **Slack** "Send Message To Channel" so moderators can review and act from chat
- When a new article row appears via **Google Sheets** "Get Rows", call **Disqus** "Create Thread" to open a matching discussion for that page
- After **Disqus** "Mark Post As Spam" flags an abusive comment, use **Gmail** "Send Message" to alert the site owner with the offending post details
