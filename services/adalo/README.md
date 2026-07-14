# Adalo FlowRunner Extension

Read and write records in your Adalo app's collections directly from a flow via the [Adalo Collections API](https://help.adalo.com/integrations/the-adalo-api). Authenticates with a Bearer API key scoped to a specific Adalo App ID.

## Ideal Use Cases

- Sync records from external systems (CRMs, spreadsheets, form submissions) into an Adalo collection so your no-code app stays up to date.
- Read collection records to power notifications, reports, or downstream integrations.
- Create, update, or remove Adalo records as part of a larger multi-step automation.

## Configuration

- **API Key** (required) — generate it in Adalo → App Settings → App Access. Sent as `Authorization: Bearer {apiKey}`. API access requires Adalo's Team or Business plan.
- **App ID** (required) — your Adalo App ID, found in the app's API section and in the app's URL.

## The Collection / Field Model

Adalo collections and fields are specific to each app, so there are no dropdowns — you supply them as free text:

- **Collection ID** — a per-app identifier found in Adalo → App → Settings → App Access → API Documentation.
- **Field keys** — keys of the Fields object must match the collection's field names (or their numeric property IDs) exactly, e.g. `{ "Name": "Ada", "Email": "ada@example.com" }`.

## List of Actions

### Records

- Create Record
- Delete Record
- Get Record
- List Records
- Update Record

## List of Triggers

This service does not define any triggers.

## Notes

- The Adalo API enforces a rate limit of roughly 5 requests per second; exceeding it returns HTTP 429. Space out high-volume operations (e.g. iterating over many records) to stay within this limit.
- On failure Adalo returns a JSON body with an `error` (or `message`) property; this service surfaces that message with the HTTP status, e.g. `Adalo API error (404): Not found`.

## Agent Ideas

- Use **Airtable** "Get Records" to pull rows from a source base, then call **Adalo** "Create Record" for each to seed or sync an Adalo collection.
- Fetch a spreadsheet's data with **Google Sheets** "Get Rows" and use **Adalo** "Update Record" to keep matching Adalo records aligned with the sheet.
- When a **Baserow** row changes, use **Adalo** "List Records" to find the matching record and **Adalo** "Update Record" to propagate the change into your Adalo app.
