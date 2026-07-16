# Storyblok FlowRunner Extension

Integrate the [Storyblok](https://www.storyblok.com/) headless CMS with FlowRunner. Read published or draft content through the Content Delivery API v2, and create, update, publish, and delete content through the Management API.

## Ideal Use Cases

- Sync stories, datasource entries, and assets from Storyblok into other apps or databases.
- Build navigation menus and sitemaps from a space's link tree.
- Programmatically create or update stories from form submissions, spreadsheets, or AI-generated drafts, then publish them.
- Preview draft content in downstream workflows before it goes live.

## List of Actions

### Content Delivery

- Get Datasource Entries
- Get Links
- Get Stories
- Get Story
- Get Tags

### Content Management

- Create Story
- Delete Story
- Get Space
- List Assets
- List Stories
- Publish Story
- Update Story

## List of Triggers

This service does not define any triggers.

## Authentication

Storyblok uses two different tokens for reading and writing. Configure the ones you need:

| Config item | Used for | Where to get it |
| --- | --- | --- |
| **Content Delivery Token** | All read operations (Get Stories, Get Story, Get Datasource Entries, Get Links, Get Tags). Passed as a `token` query parameter. | Storyblok → Space → **Settings → Access Tokens**. Use a **public** token for published content, or a **preview** token to also read the `Draft` version. |
| **Management Token** | All write operations (Create/Update/Delete/Publish Story, List Stories, Get Space, List Assets). Sent as a bare `Authorization` header. | Storyblok → **My Account → Personal access tokens**. |
| **Space ID** | Required for every Management API operation. | Storyblok → Space → **Settings → General**. |
| **Region** | Selects the correct regional API host. | Match your space's data residency: `EU` (default), `US`, `AP`, `CA`, or `CN`. |

Both tokens are optional at the config level so you can install the service for read-only or write-only use. A read operation without a Content Delivery Token, or a write operation without a Management Token or Space ID, returns a clear error.

### Regional hosts

The service selects the correct host automatically from the **Region** setting. Only **EU** uses the dedicated Management host (`mapi.storyblok.com`); every other region reuses its regional Content Delivery host for both read and write:

| Region | Content Delivery host | Management host |
| --- | --- | --- |
| EU | `https://api.storyblok.com` | `https://mapi.storyblok.com` |
| US | `https://api-us.storyblok.com` | `https://api-us.storyblok.com` |
| AP | `https://api-ap.storyblok.com` | `https://api-ap.storyblok.com` |
| CA | `https://api-ca.storyblok.com` | `https://api-ca.storyblok.com` |
| CN | `https://app.storyblokchina.cn` | `https://app.storyblokchina.cn` |

## Notes

- The **Draft** version in read operations requires a **preview** Content Delivery Token; a public token can only return the **Published** version.
- Story content objects must include a `component` key matching a content type defined in your space, e.g. `{"component":"page","title":"Hello"}`.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull a batch of content rows, then call **Storyblok** "Create Story" (with publish enabled) to load each row into the CMS as a live story.
- When a **Webflow** "On Form Submit" trigger fires, use **Storyblok** "Create Story" to draft a matching content entry and **Storyblok** "Publish Story" to make it live once reviewed.
- Use **Storyblok** "Get Stories" to fetch recently updated draft content, then **Slack** "Send Message To Channel" to notify the editorial team that new drafts are ready for review.
