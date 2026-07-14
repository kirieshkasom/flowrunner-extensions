# Raindrop.io FlowRunner Extension

Manage collections, bookmarks (raindrops), tags, and text highlights through the Raindrop.io REST API v1. Authenticates with a bearer test or OAuth access token set as the **Access Token** configuration item (sent as `Authorization: Bearer {accessToken}`).

## Ideal Use Cases

- Automatically bookmark links pulled from other apps into a chosen Raindrop collection, letting Raindrop parse page metadata.
- Sync or export a collection's bookmarks, tags, or highlights into spreadsheets, docs, or chat channels for review.
- Bulk-organize a research library: create many raindrops at once, rename or strip tags, and move bookmarks between collections.
- Curate a shared reading list by creating and nesting collections and keeping their contents tidy (Unsorted/Trash cleanup).

## List of Actions

### Collections
- Get Collections
- Get Child Collections
- Get Collection
- Create Collection
- Update Collection
- Delete Collection
- Empty Trash

### Raindrops
- Get Raindrops
- Get Raindrop
- Create Raindrop
- Update Raindrop
- Delete Raindrop
- Create Many Raindrops
- Update Many Raindrops

### Tags
- Get Tags
- Rename Tag
- Remove Tags

### Highlights
- Get All Highlights
- Get Highlights Of Raindrop

### User
- Get User

## List of Triggers

This service does not define any triggers.

## Notes

- Many operations accept a collection id. Besides real ids, these reserved values apply: `0` = all bookmarks (except Trash), `-1` = Unsorted (bookmarks not in any collection), `-99` = Trash.
- Responses are surfaced as an `{ result, item }` envelope; when Raindrop returns `result: false` the service raises a descriptive error including the HTTP status.
- When **Parse Metadata** is enabled on **Create Raindrop**, Raindrop fetches the page in the background to fill in the title, excerpt, and cover automatically.
- A **Get Collections Dictionary** picker backs collection-id parameters in other operations.

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with a URL, call **Raindrop.io** "Create Raindrop" to bookmark it into a chosen collection with tags and auto-parsed metadata.
- Use **Raindrop.io** "Get Raindrops" to pull a collection's bookmarks, then **Notion** "Create Page" for each to build a research database with titles, excerpts, and tags.
- Use **Raindrop.io** "Get All Highlights" to collect saved snippets, then **Slack** "Send Message To Channel" to share a weekly digest of highlights with your team.
