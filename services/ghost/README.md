# Ghost FlowRunner Extension

Integrate [Ghost](https://ghost.org) publishing with FlowRunner. Create and manage posts, pages, tags, members, tiers, and images through the **Ghost Admin API**, and read published content through the **Ghost Content API**.

## Ideal Use Cases

- Auto-publish AI-generated articles to a Ghost blog as drafts, scheduled, or live posts.
- Sync release notes, changelogs, or knowledge-base entries into Ghost pages.
- Manage newsletter members and tiers from a CRM or spreadsheet.
- Mirror media assets into Ghost storage by uploading images from external URLs.
- Read published content to feed downstream automations, digests, or AI agents.
- Bulk-curate tags and apply NQL filters to organize a large content library.

## List of Actions

### Posts (Admin API)
- Create Post
- Get Post
- Get Post by Slug
- List Posts
- Update Post
- Publish Post
- Delete Post

### Pages (Admin API)
- Create Page
- Get Page
- List Pages
- Update Page
- Delete Page

### Published Content (Content API)
- Get Published Posts
- Get Published Post
- Get Published Post by Slug

### Tags (Admin API)
- List Tags
- Create Tag
- Get Tag
- Update Tag
- Delete Tag

### Members (Admin API)
- List Members
- Create Member
- Get Member
- Update Member
- Delete Member

### Tiers & Newsletters (Admin API)
- List Tiers
- List Newsletters

### Images (Admin API)
- Upload Image

## Authentication

Ghost exposes two separate APIs, and this integration uses both:

- **Admin API** — full read/write access (posts, pages, tags, members, tiers, newsletters, image upload). Authenticated with an **Admin API Key** in `id:secret` form. The integration mints a short-lived JSON Web Token (HS256, 5-minute expiry) from that key on every call and sends it as `Authorization: Ghost <token>`.
- **Content API** — read-only access to **published, public** content. Authenticated with a **Content API Key** passed as a `?key=` query parameter. Used only by the "Get Published…" operations.

## Configuration

| Config item | Required | Where to find it |
| --- | --- | --- |
| **Site URL** | Yes | Your public Ghost site URL, e.g. `https://blog.example.com`. A trailing slash is stripped automatically. |
| **Admin API Key** | Yes | The integration's **Admin API Key** (`id:secret` format). Needed for every write operation. |
| **Content API Key** | No | The integration's **Content API Key**. Only needed for the "Get Published…" read operations. |

### Setup

1. In Ghost Admin, go to **Settings → Integrations → Add custom integration**.
2. Give it a name (e.g. "FlowRunner") and open it.
3. Copy the Admin API Key and Content API Key into the service configuration in FlowRunner.

> The Admin API Key secret is hex-encoded. FlowRunner handles JWT generation for you — just paste the key exactly as shown in Ghost (including the colon).

## Notes

- **HTML vs Lexical content** — Ghost stores content internally as Lexical. When you supply **HTML Content** for a post or page, the integration adds Ghost's `?source=html` query parameter so Ghost converts your HTML on the way in. Provide either HTML Content *or* Lexical Content — not both.
- **NQL filtering** — several list operations accept a **Filter** field using Ghost's NQL query language, e.g. `status:published`, `status:published+tag:news`, `featured:true`, or `status:paid` (members).
- **Collision-safe updates** — Update Post/Page require an `updated_at` value; the integration fetches it automatically if omitted.
- **Errors** — Ghost returns errors as `{ "errors": [{ "message": "...", "context": "..." }] }`. The integration surfaces both as a single `Ghost API error: <message> — <context>` message.

## Agent Ideas

- Use **Anthropic Claude** "Ask Claude" to draft an article, then call **Ghost** "Create Post" to publish it as a draft for human review before going live.
- When a new **Ghost** post is published via "Publish Post", use **Slack** "Send Message To Channel" to announce it to the team with the post's URL.
- Use **Google Sheets** "Get Rows" to read a newsletter signup list, then call **Ghost** "Create Member" for each row to onboard subscribers into the correct tier.
- Use **Notion** "Create Page" to archive a copy of each **Ghost** post fetched via "Get Published Posts" into a documentation workspace.
