# Cockpit FlowRunner Extension

FlowRunner integration for [Cockpit CMS](https://getcockpit.com) — a headless, API-first content platform, using the **Cockpit v2 Content API**. This service reads and writes structured content across content items (collections), singletons, and assets, authenticating with an API key sent as the `api-key` header. It supports MongoDB-style filtering, sorting, field projection, pagination, linked-content population, and localization.

## Ideal Use Cases

- Sync content entries from Cockpit into other systems, or push data from external sources into Cockpit collections
- Publish, update, or delete content items programmatically as part of an editorial or data pipeline
- Read singletons (e.g. site settings, homepage) to drive downstream automations
- Query and count items with filters to build reports or trigger conditional workflows
- Browse and inspect uploaded assets and their metadata

## List of Actions

### Content Items

- Count Content Items
- Delete Content Item
- Get Content Item
- Get Content Items
- Get Content Tree
- Save Content Item
- Update Content Item

### Singletons

- Get Singleton

### Assets

- Get Asset
- List Assets

## List of Triggers

This service does not define any triggers.

## Authentication

Cockpit v2 authenticates with an API key sent as the `api-key` request header. Both config items are required:

| Item | Description |
| --- | --- |
| **Cockpit URL** | Your Cockpit instance URL, e.g. `https://cms.example.com`. Any trailing slash is stripped and the API base `/api` is appended automatically. |
| **API Key** | Create one in Cockpit under **Settings → API**. |

All requests go to `{url}/api/...` with the header `api-key: {apiKey}`.

## Notes

- **Model** is the name of a collection defined in your instance, entered as free text exactly as configured (e.g. `posts`, `pages`). Singletons are fetched through the same content-item endpoint using the singleton's name.
- **MongoDB-style filtering**: `filter`, `sort`, and `fields` are object parameters serialized to JSON on the query string — e.g. filter `{"title": {"$regex": "news"}}`, sort `{"_created": -1}` (`1` ascending, `-1` descending), fields `{"title": 1}` to include or `{"content": 0}` to exclude.
- **Create vs. update**: Save Content Item both creates and updates, distinguished by `data._id`. Omit the Item ID to create (Cockpit assigns a new `_id`); provide the Item ID to update the matching entry. Update Content Item is a convenience wrapper that requires an item ID.
- Deleting a content item is permanent and cannot be undone.
- Errors are returned as `{error: ...}` (or occasionally a raw string) with an HTTP status; the service surfaces `body.error` together with the status code.
- Some endpoints are worth a live smoke test against your instance to confirm behavior across Cockpit versions.

## Agent Ideas

- Use **Cockpit** "Get Content Items" to pull entries matching a filter, feed each into **OpenAI** "Create Chat Completion" to generate summaries, and write them back with **Cockpit** "Update Content Item".
- When **Slack** "On Channel Message" fires with a content request, use **Cockpit** "Save Content Item" to create a new entry in the target model and reply via **Slack** "Send Message To Channel".
- Use **Google Drive** "Download File" to retrieve a document, extract its data, and create a corresponding entry with **Cockpit** "Save Content Item".
