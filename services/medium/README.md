# Medium FlowRunner Extension

Publish and manage content on [Medium](https://medium.com) from FlowRunner: read the current user, create posts on a profile or under a publication, list publications and contributors, and upload images. Authenticates with a Medium integration token sent as a Bearer token.

> ## ⚠️ Deprecated API — read this first
>
> **Medium's public API is deprecated and frozen.** Medium no longer issues new integration tokens for most accounts, and programmatic content publishing to Medium is effectively legacy. This service is provided for **parity** and for users who **already hold a valid integration token**. If you do not already have a token, you most likely cannot obtain one, and these operations will not work for your account.

## Ideal Use Cases

- Cross-post articles from a CMS, database, or spreadsheet into a Medium profile or publication (for accounts with an existing token).
- Programmatically create Medium drafts for later editorial review.
- Look up the authenticated user's publications and contributors to route content to the right destination.

## List of Actions

### User

- Get Current User

### Posts

- Create Post
- Create Post Under Publication

### Publications

- List User's Publications
- List Publication Contributors

### Images

- Upload Image

## List of Triggers

This service does not define any triggers.

## Authentication

This service authenticates with a Medium **integration token** (Bearer token).

| Config item | Required | Description |
| --- | --- | --- |
| Integration Token | Yes | Your Medium integration token. |

If your account still supports it, generate one at **Medium → Settings → Security and apps → Integration tokens**. Every request is sent with `Authorization: Bearer {integrationToken}`, `Content-Type: application/json`, and `Accept: application/json`.

## Create Post flow

Medium requires an **Author ID** to publish, which is the `id` of the account that owns the token:

1. Run **Get Current User** and copy the `id` field from the result.
2. Run **Create Post** and set **Author ID** to that `id`.
3. Set **Content Format** (`HTML` or `Markdown`) and provide **Content** in that format. In HTML, the first `<h1>`/`<h2>` becomes the display title.
4. Optionally set **Tags** (max 3, ≤25 chars each), **Canonical URL**, **Publish Status** (`Public`, `Draft`, `Unlisted`), **License**, and **Notify Followers**.

To publish under a publication instead, run **List User's Publications** (passing the same `id` as **User ID**), pick a **Publication ID**, then run **Create Post Under Publication**. A publications dictionary provides a searchable picker for publication fields when a User ID is supplied. Editors may publish with any status; writers may only create drafts pending approval. Once a post is public it cannot be reverted to draft via the API.

## Notes

- Medium wraps responses in a `{ "data": ... }` envelope; this service unwraps and returns the inner `data`.
- Errors are returned by Medium as `{ "errors": [{ "message", "code" }] }`; this service surfaces the joined messages along with the HTTP status.
- **Upload Image** is rarely needed — Medium auto-imports images referenced by `src` in post HTML.

## Agent Ideas

- When a **WordPress** "On New Published Post" trigger fires, use **Medium** "Create Post" to cross-post the same article to the author's Medium profile with the source URL as a canonical reference.
- Use **Notion** "Get Page" to pull a drafted article, then call **Medium** "Create Post Under Publication" (with a Publication ID from **Medium** "List User's Publications") to publish it under the team's Medium publication.
- After **Ghost** "Publish Post", use **Medium** "Create Post" to mirror the content to Medium, first calling **Medium** "Get Current User" to obtain the required Author ID.
