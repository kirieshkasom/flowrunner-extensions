# Lemlist FlowRunner Extension

FlowRunner integration for [Lemlist](https://www.lemlist.com/), the cold outreach and sales
engagement platform. Manage campaigns, add and update leads, track engagement activities, and
maintain your unsubscribe list directly from your flows.

## Authentication

Lemlist uses **HTTP Basic authentication** with an **empty username** and your **API key as the
password**. The service builds the header for you as `base64(':' + apiKey)`.

| Config Item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Your Lemlist API key. |

### Getting your API key

In Lemlist, go to **Settings → Integrations → API** and generate an API key.

## Data model

- **Campaign** — an outreach sequence, identified by a campaign id (e.g. `cam_...`). Campaigns
  hold leads and email/step configuration and expose engagement stats.
- **Lead** — a prospect within a campaign, identified by **email address**. Leads carry merge
  variables (`firstName`, `lastName`, `companyName`, and any custom fields) used in messages.
- **Activity** — an engagement event (email sent, opened, clicked, replied, bounced,
  unsubscribed, and more), filterable by type and campaign.
- **Unsubscribe** — a team-wide blocklist of email addresses excluded from all campaigns.

## Ideal Use Cases

- Sync new prospects from your CRM or enrichment tools into Lemlist campaigns automatically.
- Log outreach engagement events (opens, clicks, replies) into a spreadsheet or database for reporting.
- Honor opt-out requests globally by adding addresses to the team-wide unsubscribe blocklist.
- Route interested leads to a sales rep for manual follow-up as soon as they engage.

## List of Actions

### Campaigns

- **List Campaigns** — paginated list of campaigns (offset/limit).
- **Get Campaign** — retrieve a single campaign by id.
- **Get Campaign Stats** — aggregate engagement statistics for a campaign.

### Leads

- **Add Lead to Campaign** — add (or upsert) a lead by email, with names, company, phone,
  LinkedIn URL, and custom merge variables.
- **Get Lead** — retrieve a lead by email.
- **Update Lead** — update a lead's fields in a campaign.
- **Delete Lead from Campaign** — remove a lead from a campaign.
- **Unsubscribe Lead** — mark a lead as unsubscribed within a campaign.
- **Mark Lead as Interested** / **Mark Lead as Not Interested** — set the lead's interest status.

### Activities

- **Get Activities** — list engagement events, filterable by type and campaign, with
  limit/offset pagination.

### Unsubscribes

- **List Unsubscribes** — list team-wide unsubscribed addresses.
- **Add to Unsubscribes** — add an address to the team blocklist.
- **Delete from Unsubscribes** — remove an address from the team blocklist.

### Team

- **Get Team** — team info, sending limits, senders, and credits. Doubles as a connection check.

## List of Triggers

This service does not define any triggers.

## Dictionaries

- **Get Campaigns Dictionary** — searchable campaign picker used by campaign- and lead-related
  parameters.

## Notes

- **Base URL:** `https://api.lemlist.com/api`.
- Leads are keyed by **email address**, not by an internal id.
- Errors surface the Lemlist response message and HTTP status.

## Agent Ideas

- Use **Apollo.io** "People Search" to find target prospects, then call **Lemlist** "Add Lead to Campaign" to enroll each result into an outreach sequence with enriched merge variables.
- Use **Hunter.io** "Email Finder" to resolve a prospect's email and **Email Verifier** to confirm deliverability, then **Lemlist** "Add Lead to Campaign" to add only valid addresses.
- Poll **Lemlist** "Get Activities" for reply and click events and use **HubSpot** "Create Contact" (or "Update Contact") to sync engaged leads into your CRM.
- When **Lemlist** "Mark Lead as Interested" is applied, use **Google Sheets** "Add Row" to log the interested lead into a hot-lead handoff sheet for the sales team.
