# YOURLS FlowRunner Extension

Connects FlowRunner to your self-hosted [YOURLS](https://yourls.org) URL shortener. Shorten and expand links and read click statistics — all through the single `yourls-api.php` endpoint using signature-based passwordless API access.

## Ideal Use Cases

- Automatically shorten campaign or content links on your own branded domain before publishing them.
- Resolve incoming short URLs or keywords back to their original destinations for validation or logging.
- Report on link performance by pulling per-link click counts and instance-wide totals into dashboards or spreadsheets.
- Surface your top, most recent, or randomly sampled links for newsletters and reviews.

## List of Actions

### Links

- Shorten URL
- Expand Short URL

### Statistics

- Get URL Stats
- Get Stats
- Get Database Stats

## List of Triggers

This service does not define any triggers.

## Authentication

YOURLS uses **signature-based passwordless API access**. Every request carries your signature token, `format=json`, and an `action` parameter that selects the operation.

1. Log in to your YOURLS admin panel.
2. Go to **Tools > Secure passwordless API**.
3. Copy your **signature token**.

## Configuration

| Config          | Description                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Install URL     | Your YOURLS install URL, e.g. `https://sho.rt` (strip any trailing slash). `yourls-api.php` is appended automatically. |
| Signature Token | Your passwordless API signature token from **Tools > Secure passwordless API**.                                       |

## Notes

- All operations use a single endpoint: `{Install URL}/yourls-api.php`.
- **Duplicate URLs**: when you shorten a URL that already exists, YOURLS does not create a duplicate — it responds with `status: "fail"` and `code: "error:url"` but still includes the existing short URL. The **Shorten URL** operation surfaces that existing short link (and the duplicate notice) rather than failing, so you can safely reuse it.
- The **Filter** parameter on Get Stats maps friendly labels to YOURLS values: Top → `top`, Bottom → `bottom`, Random → `rand`, Last → `last`.

## Agent Ideas

- Use **YOURLS** "Shorten URL" to brand a campaign link, then **Slack** "Send Message To Channel" to post the short link into a marketing channel for the team to share.
- On a schedule, call **YOURLS** "Get Stats" to fetch the top-clicked links and **Google Sheets** "Add Row" to append each link and its click count into a performance-tracking spreadsheet.
- When a new record appears via **Airtable** "Get Records", use **YOURLS** "Shorten URL" to generate a trackable short link for distribution.
