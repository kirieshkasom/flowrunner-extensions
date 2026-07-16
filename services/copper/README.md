# Copper FlowRunner Extension

Manage your Copper CRM directly from FlowRunner. This extension covers people (contacts), companies, leads, opportunities (deals), tasks, and activities — with full create, read, search, update, and delete support plus lead conversion. Authentication uses a Copper API key and the associated user email.

## Ideal Use Cases

- Sync contacts and companies between Copper and other apps when records are created or updated elsewhere
- Capture inbound leads from web forms into Copper and convert qualified ones into people, companies, and opportunities
- Automate deal-pipeline updates, moving opportunities through stages or marking them Won/Lost
- Create follow-up tasks and log activities against CRM records as part of a workflow
- Search and enrich existing Copper records within multi-step automations

## List of Actions

- **People** — Create Person, Get Person, Search People, Update Person, Delete Person
- **Companies** — Create Company, Get Company, Search Companies, Update Company, Delete Company
- **Leads** — Create Lead, Get Lead, Search Leads, Update Lead, Delete Lead, Convert Lead
- **Opportunities** — Create Opportunity, Get Opportunity, Search Opportunities, Update Opportunity, Delete Opportunity
- **Tasks** — Create Task, List Tasks, Update Task, Delete Task
- **Activities** — Create Activity, List Activities

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** — Your Copper API token (Settings → Integrations → API Keys → Generate API Key), sent as `X-PW-AccessToken`.
- **User Email** — The email address of the Copper user the API key belongs to, sent as `X-PW-UserEmail`.

Dropdowns for users (assignees), pipelines, pipeline stages, customer sources, and loss reasons are populated dynamically from your Copper account.

## Notes

- **Custom fields** are passed through unchanged as an array of `{ "custom_field_definition_id": <id>, "value": <value> }` objects on the People, Company, Lead, and Opportunity actions.
- **Timestamps** (task due/reminder dates) are sent as Unix epoch seconds; ISO date/datetime inputs are converted automatically.
- **Opportunity close dates** are sent in Copper's expected `MM/DD/YYYY` format.
- **Page size** is capped at 200 on all search/list operations (Copper's limit).
- **Rate limits**: Copper allows 180 requests per minute; exceeding it returns HTTP 429.

## Agent Ideas

- Use **Typeform** "Get Form Responses" to pull recent survey entries, then call Copper "Create Lead" to add each prospect and "Convert Lead" once qualified into a person, company, and opportunity.
- When Copper "Create Opportunity" adds a deal, use **Slack** "Send Message To Channel" to notify the sales team with the deal name, value, and pipeline stage.
- After Copper "Convert Lead" produces a new person, use **Gmail** "Send Message" to send the new contact a personalized welcome email.
