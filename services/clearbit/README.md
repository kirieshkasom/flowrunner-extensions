# Clearbit FlowRunner Extension

Enrich people and companies with Clearbit's data APIs — turn an email, domain, or IP address into a rich profile (name, employment, social, firmographics, technology stack, and more). Authenticates with your Clearbit secret API key over HTTP Basic auth.

## Ideal Use Cases

- Enrich an inbound signup's email into a full person + company profile before routing to sales
- Auto-fill CRM contact and company records from just an email or domain
- Identify (reveal) the companies behind anonymous website visitors by IP for account-based marketing
- Build targeted prospect lists by searching companies and finding contacts at a domain

## List of Actions

### Enrichment

- Enrich Person
- Enrich Company
- Enrich Combined

### Prospecting

- Find Contacts (Prospector)

### Discovery

- Search Companies (Discovery)
- Reveal Company (IP Lookup)

## List of Triggers

This service does not define any triggers.

## Notes

### HubSpot / Breeze Intelligence status

Clearbit was acquired by HubSpot and is now offered as **HubSpot Breeze Intelligence**. New provisioning happens through HubSpot, and standalone Clearbit signups are closed. The legacy standalone REST endpoints (`person.clearbit.com`, `company.clearbit.com`, `reveal.clearbit.com`, etc.) continue to work for existing customers holding a legacy Clearbit **secret API key**. This service targets those documented endpoints. If your account has been fully migrated to Breeze Intelligence and the legacy key no longer works, use HubSpot's native Breeze Intelligence features instead.

### Authentication

Clearbit uses **HTTP Basic authentication** with your secret API key as the **username** and an **empty password**. The service builds the header for you as `Authorization: Basic base64("<apiKey>:")`.

| Config item | Type   | Required | Description                                                                |
| ----------- | ------ | -------- | -------------------------------------------------------------------------- |
| `apiKey`    | STRING | Yes      | Your Clearbit secret API key (Clearbit dashboard → API keys / secret key). |

### Multi-subdomain surface

Each capability lives on its own Clearbit subdomain — the service routes every operation to the correct host automatically:

| Operation                    | Endpoint                                         |
| ---------------------------- | ------------------------------------------------ |
| Enrich Person                | `GET person.clearbit.com/v2/people/find`         |
| Enrich Company               | `GET company.clearbit.com/v2/companies/find`     |
| Enrich Combined              | `GET person.clearbit.com/v2/combined/find`       |
| Find Contacts (Prospector)   | `GET prospector.clearbit.com/v1/people/search`   |
| Search Companies (Discovery) | `GET discovery.clearbit.com/v1/companies/search` |
| Reveal Company (IP Lookup)   | `GET reveal.clearbit.com/v1/companies/find`      |

**Legacy endpoints:** Prospector, Discovery, and Reveal were deprecated ahead of the HubSpot migration and may be unavailable on newer accounts. The Enrichment endpoints (Person, Company, Combined) are the primary, best-supported surface.

### Pending lookups (HTTP 202)

Clearbit performs some enrichment asynchronously. When data is not yet available it responds with **HTTP 202 Accepted** and queues the lookup. This service translates a 202 into a structured result rather than an error:

```json
{
  "pending": true,
  "status": 202,
  "message": "Clearbit is still resolving this lookup. Retry the request in a few seconds."
}
```

When you receive `pending: true`, **retry the same operation after a few seconds** — Clearbit typically resolves the record within a short window and subsequent calls return the full payload.

### Errors

API errors are surfaced as `Clearbit API error: <message> | type=<type> | status=<code>`, drawn from the Clearbit error body (`error.message`, `error.type`) plus the HTTP status.

## Agent Ideas

- Use **Clearbit** "Enrich Combined" to turn a signup email into a full person and company profile, then call **HubSpot** "Create Contact" to seed a fully populated CRM record.
- Use **Clearbit** "Reveal Company (IP Lookup)" to identify the company behind a visitor's IP, then use **Apollo** "People Search" to find decision-maker contacts at that company for outreach.
- Use **Clearbit** "Find Contacts (Prospector)" to pull business contacts at a target domain, then call **Copper** "Create Person" to add each prospect to your CRM pipeline.
