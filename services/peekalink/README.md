# Peekalink FlowRunner Extension

Peekalink turns any URL into rich, structured link-preview metadata — titles, descriptions, images, and favicons — plus platform-specific details for recognized services such as YouTube, Twitter/X, Reddit, and Amazon. Authentication uses an API key sent as the `X-API-Key` header.

## Ideal Use Cases

- Enriching user-submitted URLs with title, description, and preview imagery before storing or displaying them
- Building link-preview cards for chat, social, or content-aggregation workflows
- Extracting platform-specific details (video, author, or product data) from recognized services
- Pre-validating a batch of links to filter out those that cannot be previewed, saving requests

## List of Actions

### Link Preview

- Check Availability
- Preview Link

## List of Triggers

This service does not define any triggers.

## Authentication

API key authentication. Configure the **API Key** config item (found in your Peekalink account under the API key section); it is sent as the `X-API-Key` header. Base URL: `https://api.peekalink.io`.

## Notes

- **Preview Link** returns core metadata (title, description, url, domain, type, size, contentType, redirected, updatedAt) plus a main `image` and `favicon` when available. For recognized services a type-specific `details` object is included with platform data such as video, author, or product information.
- **Check Availability** returns a single boolean, `isAvailable`, without generating the full preview — use it as an inexpensive pre-check before **Preview Link**.
- Errors surface the API's `message` with the HTTP status: `401` (invalid or missing API key) and `429` (hourly rate limit exceeded; the quota varies by Peekalink plan tier).

## Agent Ideas

- Use **Peekalink** "Preview Link" to enrich a shared URL, then post the title, description, and image with **Slack** "Send Message To Channel" as a rich preview card.
- Use **Peekalink** "Check Availability" to filter a list of URLs, then run **Peekalink** "Preview Link" on the valid ones and log the extracted metadata into a spreadsheet with **Google Sheets** "Add Row".
- Use **Peekalink** "Preview Link" to fetch a URL's title, description, and image, then create a bookmarked reference with **Notion** "Create Page".
