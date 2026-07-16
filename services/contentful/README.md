# Contentful FlowRunner Extension

FlowRunner extension for [Contentful](https://www.contentful.com/), the API-first headless CMS. It exposes both of Contentful's core APIs: the **Content Management API (CMA, `api.contentful.com`)** for reading and writing everything — drafts, published state, assets, and content models — and the **Content Delivery API (CDA, `cdn.contentful.com`)** for fast, cached, read-only access to published content. Manage entries, assets, content types, and locales end to end.

## Ideal Use Cases

- Programmatically creating, updating, and publishing entries and assets in a content workflow
- Syncing content from external systems into Contentful with localized field values
- Fetching published content quickly through the cached Delivery API to power sites and apps
- Managing content models by creating, updating, and activating content types
- Building editorial pipelines that draft, review, archive, and publish content on a schedule

## List of Actions

### Entries

- Archive Entry
- Create Entry
- Delete Entry
- Get Entry
- List Entries
- Publish Entry
- Unarchive Entry
- Unpublish Entry
- Update Entry

### Delivery

- Get Published Entries
- Get Published Entry

### Assets

- Create Asset
- Delete Asset
- Get Asset
- List Assets
- Process Asset
- Publish Asset

### Content Types

- Activate Content Type
- Create Content Type
- Get Content Type
- List Content Types

### Locales

- List Locales

## Configuration

| Config item | Required | Notes |
| --- | --- | --- |
| **Space ID** | Yes | Contentful → Settings → General settings → Space ID. |
| **Environment ID** | No | Environment name. Defaults to `master`. |
| **Management Token** | Yes | A personal access token (starts with `CFPAT-`). Settings → API keys → Content management tokens. Required for every write/management operation and for all CMA reads. |
| **Delivery Token** | No | Content Delivery API access token. Settings → API keys → Content Delivery API. Needed only for the Get Published Entries / Get Published Entry delivery reads. |
| **Default Locale** | No | Locale code used when wrapping/unwrapping simple field maps. Defaults to `en-US`. |

## CMA vs CDA — which read to use

- Use **Get Entry / List Entries** (CMA) when you need drafts, unpublished changes, or full sys metadata. Requires the Management Token.
- Use **Get Published Entries / Get Published Entry** (CDA) when you only need published content and want faster, cached responses. Requires the Delivery Token.

## Localized fields

Contentful stores every field value keyed by locale:

```json
{ "fields": { "title": { "en-US": "Hello" } } }
```

The ergonomic entry/asset operations accept a **simple map** instead:

```json
{ "title": "Hello", "slug": "hello" }
```

Values are automatically wrapped into the localized shape using the **Locale** parameter (or the configured **Default Locale**). If you pass a value that is already an object keyed by locale codes (e.g. `{ "en-US": "Hi", "de-DE": "Hallo" }`), it is passed through unchanged — so you can mix simple values and full multi-locale/raw values in the same request.

## Versioning

Contentful uses optimistic locking. Every write to an existing resource (update, publish, unpublish, archive, process, activate) must send the resource's current `sys.version` in the `X-Contentful-Version` header. In this service you can either:

- Provide the **Version** parameter explicitly, or
- Leave it blank — the service fetches the current version automatically before writing.

## Delete behavior

Published entries and assets cannot be deleted directly. **Delete Entry** and **Delete Asset** automatically unpublish first (ignoring the "not published" case) and then delete. This is irreversible.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to read a content backlog, then call **Contentful** "Create Entry" (and "Publish Entry") to draft and publish each row as a blog post or product entry.
- After **Contentful** "Publish Entry" succeeds, use **Slack** "Send Message To Channel" to notify the editorial team with the entry ID and title.
- When **Webflow** "Create Collection Item" adds new site content, mirror it into Contentful via "Create Entry" so both CMS platforms stay in sync, and log each sync with **Google Sheets** "Add Row".
