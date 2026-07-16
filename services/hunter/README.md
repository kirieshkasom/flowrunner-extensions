# Hunter.io FlowRunner Extension

Find, verify, and enrich professional email addresses with the [Hunter.io API v2](https://hunter.io/api-documentation/v2). Discover every email at a domain, guess a specific person's address, verify deliverability before sending, enrich contacts with person and company data, and manage leads and leads lists.

## Ideal Use Cases

- Discover all publicly available emails at a company domain, with confidence scores and the detected email pattern.
- Find the most likely email address for a named individual at a given company.
- Verify an email's deliverability (MX, SMTP, disposable/webmail checks) before adding it to an outreach campaign.
- Enrich a known email with the person's role and their company's profile.
- Save qualified contacts as leads and organize them into leads lists.

## List of Actions

### Email Discovery
- Domain Search
- Email Finder
- Email Count

### Email Verification
- Email Verifier

### Enrichment
- Combined Enrichment

### Leads
- List Leads
- Create Lead
- Get Lead
- Update Lead
- Delete Lead
- List Leads Lists
- Create Leads List

### Account
- Get Account

## List of Triggers

This service has no triggers.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Your Hunter API key. Find it in Hunter → Dashboard → API → your API key. |

The API key is sent as the `api_key` query parameter on every request (Hunter uses query-parameter authentication, not an `Authorization` header).

## Notes

- **Domain Search** returns the whole picture for a domain: the email pattern, the organization, and a list of emails, each with a confidence score, type, owner, position, seniority, and department. Use `type`, `seniority`, and `department` to filter and `limit`/`offset` to paginate.
- **Email Finder** returns a single best-guess address for one named person at a company. Reach for it when you already know who you want to contact; reach for **Domain Search** when you want everyone at the domain.
- **Email Verifier** checks a single address and reports an overall status (valid, invalid, accept_all, webmail, disposable, unknown) plus the individual MX/SMTP and format checks. Run it before sending to reduce bounces.
- **Email Count** reports how many emails Hunter knows for a domain without consuming search credits — a cheap coverage check before a full Domain Search.
- **Combined Enrichment** returns both the person profile and their company profile for an email in one call.
- The **Leads List** fields on List/Create Lead are backed by a searchable picker (Get Leads Lists Dictionary); the option value is the numeric leads list id.
- Provide either a `domain` or a `company` name on Domain Search, Email Finder, and Email Count.

## Agent Ideas

- Use **Hunter.io** "Domain Search" to pull contacts at a target company, "Email Verifier" to filter to deliverable addresses, then **Gmail** "Send Message" to reach out.
- After **Hunter.io** "Email Finder" locates a prospect's address, use "Create Lead" to save them, then **Airtable** "Create Record" to log the lead in your CRM.
- Combine **Hunter.io** "Combined Enrichment" with **Google Sheets** "Add Row" to build an enriched contact list from a batch of raw email addresses.
