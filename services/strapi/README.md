# Strapi FlowRunner Extension

Connect FlowRunner to a self-hosted or Strapi Cloud instance to manage content-type entries and Media Library files through the Strapi v5 REST API.

## Ideal Use Cases

- Publish content from external systems (spreadsheets, forms, AI-generated drafts) into any Strapi collection as entries.
- Keep a headless Strapi CMS in sync with product, article, or catalog data maintained elsewhere.
- Upload images and documents to the Strapi Media Library and attach them to entries automatically.
- Read, filter, and paginate published or draft entries to feed downstream automations, notifications, or reports.
- Manage Draft & Publish workflows by creating drafts and publishing them on approval.

## List of Actions

### Entries

- Create Entry
- Delete Entry
- Get Entry
- List Entries
- Update Entry

### Media

- Delete Media File
- Get Media File
- List Media Files
- Upload File

## Configuration

| Field | Required | Description |
| --- | --- | --- |
| Base URL | Yes | Your Strapi instance URL, e.g. `https://your-strapi.example.com`. A trailing slash is stripped automatically. The REST API is reached at `{baseUrl}/api`. |
| API Token | Yes | A Strapi API token. Create one in the admin panel under **Settings → API Tokens → Create new API Token**. Grant it the token type / permissions your operations need (Full access, or a custom scope covering the collections you use). |

Requests authenticate with `Authorization: Bearer <API Token>`.

## Strapi v5 and documentId

Strapi v5 identifies a content-type entry (a "document") by its **`documentId`** — a stable string such as `znrlzntu9ei5onjvwfaalu2v` — rather than the numeric `id` used in Strapi v4. Single-entry operations (Get / Update / Delete Entry) take the `documentId` and call `/api/{collection}/{documentId}`.

Strapi v5 also **flattens** each entry: its fields sit directly on the data object next to `id`, `documentId`, `createdAt`, `updatedAt`, `publishedAt`, and `locale` — there is no `attributes` wrapper (a change from v4). List responses return entries in `data` and pagination in `meta.pagination` (`page`, `pageSize`, `pageCount`, `total`).

> The Media Library (upload plugin) is separate and still identifies files by their **numeric `id`**. Media actions and the `refId` attach field use that numeric id, not a documentId.

## Collections

Because content types are defined by you in Strapi, the **Collection** parameter is a free-form string: the *plural API ID* used in the REST URL — for example `articles`, `products`, `categories`. You can find it in the Strapi admin under Content-Type Builder, or as the segment after `/api/` in the collection's REST endpoint.

## Filter syntax

The **Filters** parameter takes a nested object that is flattened into Strapi's bracket query syntax. For example:

```json
{ "title": { "$contains": "hello" }, "rating": { "$gte": 4 } }
```

becomes `filters[title][$contains]=hello&filters[rating][$gte]=4`.

Supported document operators include `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$contains`, `$notContains`, `$in`, `$notIn`, `$null`, `$notNull`, `$startsWith`, and `$endsWith`. Array operators like `$in` accept an array value: `{ "id": { "$in": [1, 2, 3] } }`.

Other query helpers:

- **Populate** — `*` for all relations/components/media, or a comma-separated list of field names (`author,cover`).
- **Sort** — comma-separated `field:direction` clauses (`createdAt:desc,title:asc`).
- **Fields** — comma-separated field selection (`title,slug`).
- **Pagination** — `Page` and `Page Size`.
- **Locale** — a locale code (`en`, `fr`) when i18n is enabled.
- **Status** — `Published` or `Draft` for Draft & Publish content types.

## Draft & Publish

For content types with Draft & Publish enabled, reads accept a **Status** of `Published` (live) or `Draft`. New entries are created as drafts unless created with status `Published`. To publish an existing draft, update it with status `Published` (or set its `publishedAt` field). Whether these workflows are available depends on the content type's Draft & Publish setting in Strapi.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to read a content backlog, then call **Strapi** "Create Entry" for each row to bulk-publish articles or products into a collection.
- When **Slack** "On File Shared" fires, use **Strapi** "Upload File" to push the asset into the Media Library and attach it to the relevant entry via `ref` / `refId` / `field`.
- Use **Strapi** "List Entries" to fetch newly published drafts, then send an approval prompt with **Gmail** "Send Message" before calling **Strapi** "Update Entry" with the status set to `Published`.
