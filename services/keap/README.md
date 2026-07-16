# Keap FlowRunner Extension

Integrate [Keap](https://keap.com) (formerly Infusionsoft) CRM, e-commerce and marketing automation into FlowRunner. This service wraps the Keap REST v1 API for contacts, tags, companies, opportunities, orders, products, notes, tasks and campaigns, plus a realtime trigger driven by Keap REST Hooks.

## Ideal Use Cases

- Sync new contacts and companies into Keap from web forms, spreadsheets or other CRMs.
- Automate tagging to drive Keap campaigns and follow-up sequences.
- Track a sales pipeline by creating opportunities and advancing them through stages.
- React in real time when a contact, opportunity, order or task changes in Keap.

## List of Actions

### Contacts

- Create Contact, Get Contact, List Contacts, Update Contact, Delete Contact

### Tags

- List Tags, Create Tag, Apply Tag to Contact, Remove Tag from Contact

### Companies

- Create Company, Get Company, List Companies, Update Company

### Opportunities

- Create Opportunity, Get Opportunity, List Opportunities, Update Opportunity

### Orders & Products

- List Orders, Get Order, List Products

### Notes & Tasks

- Create Note, Create Task, List Tasks

### Campaigns

- List Campaigns

## List of Triggers

- On Keap Event

## Authentication

The service authenticates with a single **API Key** config item, sent to every request as `Authorization: Bearer <token>`. Keap accepts several token types here:

- **Personal Access Token (PAT)** — the simplest option for a single Keap account. Create one at [https://keys.developer.keap.com](https://keys.developer.keap.com).
- **Service Account Key** — also created at [https://keys.developer.keap.com](https://keys.developer.keap.com); suited to server-to-server automation.
- **OAuth2 access token** — the alternative for multi-account / distributed apps, where each end user connects their own Keap account. Obtain the access token via Keap's OAuth2 authorization flow and supply it here.

For most FlowRunner use cases a **PAT or Service Account Key is recommended** — it needs no OAuth round-trip. Use OAuth2 only when you must connect many separate Keap accounts.

## Notes

- Requests target the Keap REST **v1** base URL `https://api.infusionsoft.com/crm/rest/v1`, the most complete and stable surface. A subset of resources also expose a newer v2 surface at `/crm/rest/v2`, noted in the code where relevant, but v1 remains the primary target.
- **On Keap Event** (`SINGLE_APP`) fires on account-wide events via Keap REST Hooks. Choose an event from the dropdown — Contact Added / Updated / Deleted, Opportunity Added / Updated / Deleted, Order Added, or Task Added. The service handles Keap's `X-Hook-Secret` verification handshake automatically, so no manual verification step is required.
- Opportunity stage, tag, product and campaign selections are powered by dictionary pickers backed by the Keap API.
- Keap error responses are surfaced with their `message` (or XML-RPC style `fault`) so failures are easy to diagnose.

## Agent Ideas

- When an **On Keap Event** "Contact Added" trigger fires, use **Gmail** "Send Message" to send the new contact a personalized welcome email.
- Use **Google Sheets** "Get Rows" to read a lead list, then call **Keap** "Create Contact" and "Apply Tag to Contact" to import and segment each lead into the right campaign.
- When an **On Keap Event** "Order Added" trigger fires, use **Slack** "Send Message To Channel" to notify the sales team with the order and contact details.
