# Bitly FlowRunner Extension

Shorten, manage, and measure links with [Bitly](https://bitly.com) from FlowRunner. Create short links, retrieve and update Bitlinks, pull click analytics, generate QR codes, and inspect your groups and organizations. Authenticates with a Bitly access token sent as a Bearer token (`Authorization: Bearer <accessToken>`).

## Ideal Use Cases

- Automatically shorten campaign or content URLs and post the resulting Bitlinks to social, email, or chat channels.
- Track and report click performance by pulling per-Bitlink click summaries, time series, country, and referrer breakdowns.
- Generate branded QR codes for print or in-app use that route to tracked Bitlinks.
- Keep a catalog of Bitlinks in sync by listing, updating titles/tags, or archiving links across a group.

## List of Actions

### Links

- Shorten Link
- Create Bitlink
- Get Bitlink
- Update Bitlink
- Expand Bitlink
- List Bitlinks by Group

### Metrics

- Get Clicks Summary
- Get Clicks
- Get Clicks by Country
- Get Clicks by Referrer

### QR Codes

- Create QR Code

### Organization

- List Groups
- Get Group
- Get Organizations
- Get User

## List of Triggers

This service does not define any triggers.

## Authentication

Authenticates with a **Bitly access token** sent as a Bearer token (`Authorization: Bearer <accessToken>`).

To create one: sign in to Bitly, go to **Settings → API**, and generate an access token (an OAuth-issued token works too — a generic access token works either way). Paste it into the **Access Token** config field when adding this service.

## Notes

- **Bitlink id format** — Bitlinks are referenced by their id in the form `bit.ly/abc123` (domain + hash), **not** a full URL. Operations accept either `bit.ly/abc123` or `https://bit.ly/abc123`; the `https://` prefix is stripped automatically.
- **Group (`group_guid`)** — Bitlinks, campaigns, and metrics are scoped to a group (a Bitly Sub-Domain / BSD). Most creation and listing operations accept an optional group; leave it blank to use your account's default group. Use **List Groups** (or the Get Groups Dictionary picker) to look up a group GUID.
- **Organizations** — the top-level container for groups. Use **Get Organizations** to list them.
- Click metrics accept a **Unit** (Minute, Hour, Day, Week, Month) and a **Units** count; use `-1` units to request all available data.
- **Create QR Code** saves the QR image to FlowRunner file storage (provisioned automatically) and returns a downloadable URL.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to read long marketing URLs, call **Bitly** "Shorten Link" for each, then write the short links back with **Google Sheets** "Add Row".
- After **Bitly** "Create Bitlink" produces a tracked short link, use **Slack** "Send Message To Channel" to share it with the marketing team for a campaign launch.
- On a schedule, call **Bitly** "Get Clicks Summary" for key Bitlinks and use **Google Sheets** "Add Row" to log daily click totals into a performance dashboard.
