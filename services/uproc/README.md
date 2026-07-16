# uProc FlowRunner Extension

FlowRunner extension for [uProc](https://uproc.io) — a data enrichment, validation, and cleaning
platform. uProc exposes hundreds of "tools" (processors) across groups like email, phone, company,
IP, geolocation, text, and image, all reachable through a single generic runner plus convenience
wrappers for the most common verification and enrichment tasks.

## Ideal Use Cases

- Verify email deliverability and phone validity before adding contacts to a CRM or outreach list.
- Enrich lead records by inferring gender from a first name or searching company data by name.
- Run any uProc processor (text transforms, IP/geolocation lookups, image tools, and more) via the
  generic Run Tool escape hatch when no dedicated wrapper exists.
- Monitor remaining uProc credits before launching a large batch of enrichment calls.

## List of Actions

### Tools
- Run Tool — run any uProc processor by name (`group-tool` form) with an arbitrary params object.

### Email
- Verify Email

### Phone
- Verify Phone

### Enrichment
- Get Gender by Name
- Company Search

### Catalog
- List Groups
- List Tools

### Account
- Get Profile

## List of Triggers

This service does not define any triggers.

## Authentication

uProc uses HTTP Basic authentication built from your account email and API key
(`base64('{email}:{apiKey}')`). Configure two items:

- **Account Email** — the email address you use to sign in to uProc.
- **API Key** — from **uProc → Integration → API Key**. Use the **Real** key for production; the
  **Test** key returns fake data.

## Notes

- Base URL is `https://api.uproc.io/api/v2`. Most operations resolve to a single processing endpoint
  with a body of `{ processor, params }`, where `processor` is a tool name in `group-tool` form
  (e.g. `email-check-exists`). Endpoints are worth live smoke-testing against your account before
  relying on them in production.
- Each successful data-processing call consumes uProc credits. Use **Get Profile** to check your
  remaining balance and confirm your email/API key are valid.
- Browse the full processor catalog at [app.uproc.io/#/tools](https://app.uproc.io/#/tools). Common
  examples: `email-check-exists` → `{ "email": "john@doe.com" }`, `phone-check-exists` →
  `{ "phone": "+14155552671", "country": "US" }`, `name-get-gender` → `{ "name": "Alexandra" }`,
  `company-search-by-name` → `{ "name": "uProc", "country": "ES" }`.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull a list of leads, run **uProc** "Verify Email" on each
  address, then **Google Sheets** "Add Row" to a clean list holding only deliverable contacts.
- Before **HubSpot** "Create Contact", call **uProc** "Verify Phone" and "Get Gender by Name" to
  validate and enrich each record so only high-quality contacts land in the CRM.
- Combine **Hunter.io** "Domain Search" to discover email addresses with **uProc** "Verify Email"
  to filter out undeliverable ones before starting an outreach sequence.
