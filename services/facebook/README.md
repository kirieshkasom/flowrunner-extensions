# Facebook FlowRunner Extension

Integrate Facebook Pages with FlowRunner via the [Facebook Graph API](https://developers.facebook.com/docs/graph-api). Publish and manage Page posts and photos, read and moderate comments, like content, and pull Page and post insights.

This is the general Pages/Graph service. For lead-form retrieval specifically, see the separate `facebook-lead-ads` service.

## Ideal Use Cases

- Cross-post content from another system (blog, CMS, spreadsheet) to a Facebook Page automatically.
- Schedule Page posts in advance and manage a content calendar.
- Monitor and moderate comments on Page posts, replying or removing them programmatically.
- Report on Page growth and post performance by pulling insights into a spreadsheet or dashboard.
- Upload images to a Page from external URLs or FlowRunner file storage.

## Authentication

This service uses an **access token** (API-key style), not the interactive OAuth redirect flow. Meta's OAuth login flow requires an app that has passed App Review before it can request Page permissions, so this service instead accepts a token you generate directly.

### Getting a token

1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/) (or your app's Business settings).
2. Select your app and generate a **User Access Token** with these permissions (scopes):
   - `pages_manage_posts` — create, edit, and delete Page posts and photos.
   - `pages_read_engagement` — read Page details, posts, and comments.
   - `pages_manage_engagement` — create comments and likes (for moderation actions).
   - `read_insights` — read Page and post insights.
3. **Use a long-lived token.** Short-lived tokens expire in ~1 hour. Exchange for a long-lived token (~60 days) via the token debugger or the `/oauth/access_token` endpoint. Page access tokens derived from a long-lived user token do not expire.

Paste the token into the **Access Token** config item.

### Page access tokens (important)

Page-scoped operations (posting, photos, comments, likes, insights) must be authorized with the **Page's own access token**, not a plain user token.

1. Run **List My Pages** — it calls `GET /me/accounts` and returns each Page you manage along with its `access_token`.
2. Copy the target Page's `access_token`.
3. Pass it as the **Page Access Token** parameter on any page operation. It overrides the configured token for that call.

If you set the configured **Access Token** to a specific Page token, you can omit the per-operation Page Access Token for that Page.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Access Token | Yes | A Page or User access token with the scopes above. Long-lived recommended. |
| API Version | No | Graph API version to target (default `v25.0`). |

## List of Actions

**Pages**
- **List My Pages** — the Pages you manage, each with its own `access_token`.
- **Get Page** — Page details (name, fan_count, about, category, link, …).

**Posts**
- **Create Page Post** — publish a text/link post; supports drafts and scheduling.
- **Get Post** — a post with like/comment/share summaries.
- **List Page Posts** — a Page's feed with engagement summaries and paging.
- **Update Post** — edit a post's message.
- **Delete Post** — permanently remove a post.

**Photos**
- **Upload Photo** — upload from an external image URL or a Flowrunner file (multipart); returns photo id and post_id.

**Comments**
- **Get Comments** — comments on a post/photo/comment.
- **Create Comment** — reply on an object.
- **Delete Comment** — remove a comment.
- **Like Object** — like a post/photo/comment as the Page.

**Insights**
- **Get Page Insights** — Page metrics (e.g. `page_impressions`, `page_fans`) by day/week/28-day period.
- **Get Post Insights** — post metrics (e.g. `post_impressions`, `post_engaged_users`).

**Miscellaneous**
- **Get Object** — generic fetch of any Graph node by id with a custom `fields` list.

## Pagination

List operations return Graph's `{ data, paging: { cursors: { after }, next } }` shape. Pass the `paging.cursors.after` value back as the **After Cursor** parameter to page forward.

## Notes

- Errors surface the Graph API `error.message`, `error.type`, `error.code`, and `error.fbtrace_id` — include the `fbtrace_id` when contacting Meta support.
- Scheduled posts require `published = false` and a `scheduled_publish_time` between 10 minutes and 6 months in the future.

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with a piece of content, use **Facebook** "Create Page Post" to publish it (or schedule it) to your Page, then log the returned post id back with "Add Row".
- When a **Gmail** "On New Email" trigger delivers an image attachment, use **Facebook** "Upload Photo" to publish it to the Page and **Slack** "Send Message To Channel" to confirm the post went live.
- On a schedule, use **Facebook** "Get Page Insights" and "Get Post Insights" to pull performance metrics, then use **Google Sheets** "Add Row" to append them to a reporting spreadsheet.
