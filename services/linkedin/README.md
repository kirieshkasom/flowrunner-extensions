# LinkedIn FlowRunner Extension

Publish and manage LinkedIn content from FlowRunner. Create text, article-link, and image posts as
a member or a company page; read and delete posts; comment on and like posts; and list the
organizations (company pages) the connected member administers. Authentication is OAuth 2.0
(3-legged, OpenID Connect); posts are created through LinkedIn's versioned Posts API.

## Ideal Use Cases

- Automatically share new blog articles, product launches, or announcements to a company page.
- Cross-post content from other channels (spreadsheets, CMS, newsletters) into LinkedIn.
- Publish image posts (e.g. event photos, marketing creatives) fetched from a URL in one step.
- Engage with your own content by programmatically commenting on or liking posts.
- Enrich a CRM or reporting workflow with the list of organizations a member administers.

## List of Actions

### Profile

- Get My Profile

### Posts

- Create Post
- Create Image Post
- Get Post
- Delete Post

### Organizations

- Get My Organizations
- Get Organization

### Social Actions

- Create Comment
- Get Comments
- Like Post

## List of Triggers

This service has no triggers.

## Authentication

This service uses OAuth 2.0. Configure your LinkedIn app in the
[LinkedIn Developer Portal](https://www.linkedin.com/developers/apps), then provide:

- **Client Id** — your app's OAuth 2.0 Client ID (Auth tab).
- **Client Secret** — your app's OAuth 2.0 Client Secret (Auth tab).

Requested scopes: `openid profile email w_member_social r_organization_social
w_organization_social rw_organization_admin`. Only the scopes your app has been granted products
for will actually be authorized.

## Required app products and approval

LinkedIn's API is product-gated — an endpoint returns `403 ACCESS_DENIED` unless your app has the
matching product approved:

- **Sign In with LinkedIn using OpenID Connect** — grants `openid profile email`, powers *Get My
  Profile* and the person author URN.
- **Share on LinkedIn** — grants `w_member_social`, required to create/delete member posts and to
  comment/like as a member.
- **Community Management API** — grants the `*_organization_*` and `rw_organization_admin` scopes,
  required for *Get My Organizations*, *Get Organization*, and posting/commenting as a company
  page. This product requires a separate LinkedIn review and approval.

Reading other members' posts (`r_member_social`) is a restricted scope available to approved
partners only; *Get Post* / *Get Comments* work reliably for content you authored.

## URN concepts

LinkedIn identifies entities by URN:

- **Person**: `urn:li:person:{sub}` — the `sub` comes from *Get My Profile*.
- **Organization** (company page): `urn:li:organization:{id}`.
- **Post**: `urn:li:share:{id}` or `urn:li:ugcPost:{id}` (both accepted by *Get Post* / *Delete
  Post*).
- **Image**: `urn:li:image:{id}` — returned by the image upload step.

Author-taking actions (*Create Post*, *Create Image Post*, *Create Comment*, *Like Post*) default
to the connected member when no author is supplied. To act as a company page, pass an organization
URN (or pick one from the built-in organizations dictionary).

## Image post flow

*Create Image Post* implements LinkedIn's multi-step image flow automatically:

1. `POST /rest/images?action=initializeUpload` with `{ initializeUploadRequest: { owner } }` →
   returns an `uploadUrl` and an image URN.
2. The image bytes are fetched from the supplied URL and `PUT` to `uploadUrl`.
3. `POST /rest/posts` with `content.media.id` set to the new image URN publishes the post.

Supported formats: JPG, PNG, GIF (under ~36 megapixels).

## API version

Versioned endpoints under `/rest` send `LinkedIn-Version: 202606` (YYYYMM format) and
`X-Restli-Protocol-Version: 2.0.0`. Update the `LINKEDIN_VERSION` constant in `src/index.js` when
migrating to a newer LinkedIn API version.

## Error handling

API failures surface LinkedIn's `message`, `serviceErrorCode`, and HTTP status, e.g.
`LinkedIn API error: Insufficient permissions... (serviceErrorCode 65600) [HTTP 403]`. A `403`
usually means the app is missing the required product/scope (see above).

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with a queued post, use **LinkedIn** "Create Post" to publish it to the company page, then **Slack** "Send Message To Channel" to confirm it went live.
- Use **Notion** "Create Page" to draft an article, then **LinkedIn** "Create Image Post" to publish it with a cover image and **HubSpot** "Create Contact" to log anyone who engages.
- When **Gmail** "On New Email" receives a customer testimonial, use **LinkedIn** "Create Post" to share the quote and **Google Sheets** "Get Rows" to pull the matching customer details for attribution.
