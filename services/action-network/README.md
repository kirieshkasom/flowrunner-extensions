# Action Network FlowRunner Extension

Connects FlowRunner to [Action Network](https://actionnetwork.org/), the organizing platform for progressive campaigns, via its OSDI-compliant REST API. Authenticate with your group's API key (sent as the `OSDI-API-Token` header) to manage activists, events, tags, and action pages. Responses follow the HAL hypermedia model, with collections under `_embedded` and pagination/related resources under `_links`.

## Ideal Use Cases

- Sync new sign-ups, donors, or event RSVPs from external forms and CRMs into your Action Network activist list.
- Upsert people by email so contacts are merged rather than duplicated, applying or removing tags in the same call.
- Automate event creation and pull attendance, submissions, and petition signatures for reporting.
- Track email message performance (sent, opened, clicked) and export it to a spreadsheet or dashboard.
- Segment activists by applying tags in response to activity in other tools.

## List of Actions

- **People** — List People, Get Person, Add or Upsert Person, Update Person
- **Events** — List Events, Get Event, Create Event
- **Action Pages** — List Forms, List Petitions, List Fundraising Pages, List Advocacy Campaigns
- **Tags** — List Tags, Get Tag, Add Tagging
- **Messages** — List Messages, Get Message
- **Responses** — List Form Submissions, List Petition Signatures

## List of Triggers

This service does not define any triggers.

## Authentication

API-key based. Provide your **API Key** in the service configuration; it is sent as the `OSDI-API-Token` header. Find it in Action Network under your group → Start Organizing → Details → API & Sync → API Key (a partner feature that may need to be requested). The API base URL is `https://actionnetwork.org/api/v2`.

## Notes

- **Upsert semantics**: *Add or Upsert Person* uses Action Network's `person_signup_helper` (`POST /people`) and matches on email address — an existing person is merged/updated instead of duplicated. Either an email address or phone number is required.
- **Tags**: *Add or Upsert Person* accepts Add Tags / Remove Tags matched to existing group tags by name (unknown names ignored); use *Add Tagging* to link an existing tag UUID to a person directly. A tag picker is available for tag parameters.
- **HAL responses**: Collections are returned under `_embedded['osdi:...']` with `_links` for pagination (next/previous) and related resources; list actions page 25 records at a time via `page` and accept an OData `filter` expression (e.g. `email_address eq 'user@example.com'`).
- **IDs**: Action Network resource IDs are UUIDs, exposed in each item's `_links.self` URL and its `identifiers` array. Errors surface the OSDI error body together with the HTTP status.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to read a list of new supporters, then call **Action Network** "Add or Upsert Person" for each row to sync them into your activist list with the right tags applied.
- After **Action Network** "List Petition Signatures" returns signers of a petition, use **Mailchimp** "Add Or Update List Member" to add each signer to a follow-up email audience.
- When you create an event with **Action Network** "Create Event", use **Slack** "Send Message To Channel" to announce it to your organizing team with the browser URL.
