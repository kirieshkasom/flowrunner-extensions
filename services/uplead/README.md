# UpLead FlowRunner Extension

Access UpLead's B2B contact and company database from FlowRunner. Enrich people and companies, search for contacts at a target company, and check your remaining API credits. Every successful response wraps its payload under `data`, alongside a `userInfo` object reporting `availableCredits`.

## Ideal Use Cases

- Enrich an inbound lead's work email into a full contact profile (title, verified email, phone, LinkedIn, company) before routing it to sales.
- Build prospect lists by searching all contacts at a target company, filtered by job function, seniority, title, and location.
- Enrich a company by domain to pull firmographics (employees, revenue, industry, SIC/NAICS, socials) for account scoring or CRM sync.
- Turn a bare email into both the person and their company record in a single call for fast form-fill or CRM auto-population.
- Monitor remaining API credits and validate the connection before running batch enrichment jobs.

## List of Actions

### Enrichment
- Enrich Person
- Enrich Company
- Enrich Person and Company

### Prospecting
- Search Contacts

### Account
- Get Remaining Credits

## List of Triggers

This service does not define any triggers.

## Authentication

UpLead uses an API key sent as the raw `Authorization` header (no `Bearer` prefix).

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Your UpLead API key. Find it in UpLead under **Integrations / API**. |

## Notes

- Successful responses return the payload under `data`, with credit status under `userInfo.availableCredits`.
- UpLead deducts credits per revealed record: enrichment charges one credit per successful match with a valid or accept-all email, while Search Contacts charges only when contact records are revealed.
- Search Contacts returns people under `data.results` with pagination details under `data.meta` (total, page, next_page, previous_page, first_page, last_page).
- Management Level labels (Manager, Director, Vice President, C-Level (C), C-Level (CX)) map to UpLead codes M, D, VP, C, and CX.

## Agent Ideas

- Use UpLead **Enrich Person and Company** on an inbound email, then call **HubSpot** "Create Contact" and "Create Company" to auto-populate the CRM with a verified, enriched record.
- Run UpLead **Search Contacts** against a target company domain, then use **Google Sheets** "Add Rows" to build a fresh prospect list of names, titles, and verified emails.
- After UpLead **Enrich Company** returns firmographics for a new domain, use **Pipedrive** "Create Deal" to open an opportunity pre-filled with the account's size, revenue, and industry.
