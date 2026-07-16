# Dropcontact FlowRunner Extension

Enrich contacts with verified professional emails and company data using [Dropcontact](https://www.dropcontact.com), a GDPR-compliant, EU-focused B2B enrichment service. Dropcontact finds and verifies professional email addresses, appends company and legal data (including French SIREN/NAF/VAT), and never buys or resells personal data. It authenticates with a Dropcontact API key sent as the `X-Access-Token` header and uses an asynchronous batch-then-poll enrichment flow.

## Ideal Use Cases

- Enrich newly captured leads with verified professional emails, phone numbers, and company details before adding them to your CRM.
- Clean and complete large contact lists in batches (up to 250 records per request) while staying GDPR/EU-compliant.
- Retrieve French legal/company data (SIREN, NAF code, VAT, registered address) for B2B records based in France.
- Resolve a single contact synchronously in one step using the built-in wait-and-poll convenience operation.

## List of Actions

### Enrichment

- Enrich Contacts (Batch)
- Get Enrichment Result
- Enrich and Wait

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses an API key.

| Config Item | Required | Description |
| --- | --- | --- |
| API Key | Yes | Your Dropcontact API key, sent as the `X-Access-Token` request header. Find it in Dropcontact → Account → API → your API key. |

All requests are sent to `https://api.dropcontact.com` with the headers:

```
X-Access-Token: <your api key>
Content-Type: application/json
```

## Asynchronous batch → poll flow

Dropcontact enrichment is **asynchronous**. You submit a batch of contacts and immediately receive a `request_id`; the enriched data is produced in the background and must be retrieved by polling.

1. **Enrich Contacts (Batch)** — submit one or more contacts. Returns `{ success, request_id, credits_left }`. No enriched data is returned here.
2. **Get Enrichment Result** — call with the `request_id`. While processing it returns `success: false` with a `reason` (e.g. "Request not ready yet, try again in 30 seconds"). Keep polling every ~10–30 seconds until it returns `success: true` with a populated `data` array.

Typical enrichment finishes within a couple of minutes for small batches.

### Enrich and Wait (convenience)

If you would rather not manage the `request_id` and polling yourself, use **Enrich and Wait**. It submits the contact(s) and polls internally (bounded to roughly 90 seconds to stay within the execution timeout):

- If the result is ready in time, it returns `{ status: "completed", request_id, credits_left, data: [...] }`.
- If Dropcontact is still processing when polling ends, it returns `{ status: "pending", request_id, ... }` so you can retry later with **Get Enrichment Result**.

## Single contact vs. batch

Every enrichment operation accepts input two ways:

- **Single-contact convenience fields** — fill in individual fields (`Email`, `First Name`, `Last Name`, `Full Name`, `Company`, `Website`, `Phone`, `SIREN Number`, `LinkedIn URL`) for one contact.
- **Batch** — supply a `Contacts` array of contact objects (up to 250 per request). When a non-empty `Contacts` array is provided, it takes precedence over the single-contact fields.

To get a match, provide at least one of: an email address, first name + last name + company (or full name + company), or a LinkedIn URL.

Enable **Fetch SIREN Data** to also retrieve French legal/company data (SIREN, NAF code, VAT number, registered address). Use **Language** (`en`/`fr`) to control the language of returned company descriptions and labels.

## Errors

API failures surface as `Dropcontact API error: <message>`, using Dropcontact's `error` / `reason` response field (or the HTTP status message) where available.

## Agent Ideas

- Use **Hunter.io** "Domain Search" to discover contacts at a target company, then call **Dropcontact** "Enrich and Wait" to verify each professional email and attach company details before outreach.
- When a lead is missing data, run **Dropcontact** "Enrich Contacts (Batch)" and "Get Enrichment Result", then push the enriched record into **HubSpot** with "Create Contact" or "Update Contact".
- Pull prospects from **Apollo.io** "People Search", enrich them with **Dropcontact** "Enrich and Wait" for GDPR-compliant verified emails, and sync the completed records back into your CRM.
