# Google Books FlowRunner Extension

Search and browse books and magazines through the Google Books catalog. Look up volume metadata, run rich keyword searches, and read public users' bookshelves. Public search works with no credentials; an optional Google Cloud API key raises request quotas.

## Ideal Use Cases

- Look up bibliographic details (title, authors, publisher, page count, cover image) by ISBN, title, or author
- Enrich a book database or reading list with metadata pulled from a single volume ID
- Build catalog search into an app with pagination, sorting, language, and print-type filters
- Browse a Google user's public bookshelves and the volumes on each shelf

## List of Actions

### Volumes

- Get Volume
- Search Volumes

### Bookshelves

- Get Public Bookshelf
- List Bookshelf Volumes
- List Public Bookshelves

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** (optional) — a Google Cloud API key with the Books API enabled, appended to every request as the `key=` query parameter for higher quotas. Public search and public bookshelf reads work without it. Create one at https://console.cloud.google.com/apis/credentials

## Notes

- **Query qualifiers** for Search Volumes can be combined with keywords: `intitle:` (title), `inauthor:` (author), `inpublisher:` (publisher), `subject:` (category), `isbn:` (specific ISBN). Example: `flowers inauthor:keyes intitle:garden`.
- Search Volumes returns up to 40 results per page (Max Results) and supports Start Index pagination, Relevance/Newest ordering, print-type and content filters, language restriction, and Lite/Full projection.
- Volume IDs come from the `id` field of Search Volumes results; user IDs are numeric Google account IDs.
- Bookshelf operations only return data for shelves the owning user has made **public**; use a shelf's `id` as the Shelf ID for Get Public Bookshelf and List Bookshelf Volumes.

## Agent Ideas

- Use **Google Books** "Search Volumes" with an `isbn:` qualifier to resolve a book's metadata, then **Google Sheets** "Add Row" to log the title, authors, and page count into a reading-list spreadsheet.
- When a user shares a book title in Slack, call **Google Books** "Search Volumes" and reply with **Slack** "Send Message To Channel" containing the top match's author, publisher, and cover thumbnail.
- Use **Google Books** "Get Volume" to fetch full details for a volume ID, then **Notion** "Create Page" to add a richly populated entry to a personal library database.
