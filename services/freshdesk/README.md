# Freshdesk FlowRunner Extension

FlowRunner extension for [Freshdesk](https://www.freshdesk.com/), the customer support and helpdesk platform by Freshworks. Manage tickets, ticket conversations, contacts, companies, agents, and groups through the Freshdesk REST API v2.

## Ideal Use Cases

- Automatically create support tickets from inbound emails, form submissions, or chat messages.
- Sync new or updated customers into Freshdesk as contacts and companies.
- Post automated replies and internal notes on tickets as part of an escalation or triage workflow.
- Search tickets and contacts on arbitrary criteria to drive reporting or follow-up automations.
- Look up account metadata (agents, groups, ticket fields) to build dynamic support workflows.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Domain | Yes | Your Freshdesk subdomain. For `yourcompany.freshdesk.com`, enter `yourcompany`. |
| API Key | Yes | Your Freshdesk API key. Find it in Freshdesk under **Profile Settings → View API Key**. |

Authentication uses HTTP Basic auth with the API key (`{apiKey}:X`), as required by the Freshdesk API.

## List of Actions

### Tickets

- Add Note
- Add Reply
- Create Ticket
- Delete Ticket
- Get Ticket
- List Ticket Conversations
- List Tickets
- Search Tickets
- Update Ticket

### Contacts

- Create Contact
- Delete Contact
- Get Contact
- List Contacts
- Search Contacts
- Update Contact

### Companies

- Create Company
- Get Company
- List Companies

### Admin

- List Agents
- List Groups
- List Ticket Fields

## List of Triggers

This service has no triggers. Freshdesk webhooks are configured as automation rules in the Freshdesk admin UI (Admin → Workflows → Automations) rather than through a public webhook management API, so realtime triggers cannot be provisioned programmatically.

## Search query syntax

Search Tickets and Search Contacts use the Freshdesk query language (Lucene-like). Combine field conditions with `AND` / `OR` and group with parentheses. The surrounding double quotes required by the API are added automatically.

Examples:

- `priority:4 AND status:2` — urgent open tickets
- `type:'Question' OR tag:'urgent'`
- `created_at:>'2026-07-01' AND agent_id:2043000654321`
- Contacts: `email:'jane.doe@example.com'`, `tag:'vip'`

Numeric values: priority `1`=Low, `2`=Medium, `3`=High, `4`=Urgent; status `2`=Open, `3`=Pending, `4`=Resolved, `5`=Closed. Search returns up to 30 results per page, maximum 10 pages (300 results). Use **List Ticket Fields** to discover custom field names (e.g. `cf_order_id`) accepted by Create Ticket and Update Ticket.

## Rate limits

The Freshdesk API is rate-limited per account/plan. When a request is throttled (HTTP 429), the error message surfaces the `Retry-After` interval reported by Freshdesk.

## Agent Ideas

- When **Gmail** "On New Email" detects an inbound support request, call Freshdesk "Search Contacts" to find the sender, then "Create Ticket" with the email body as the HTML description and the contact as requester.
- After Freshdesk "Create Ticket" runs, use **Slack** "Send Message To Channel" to notify the support team with the ticket subject, priority, and assigned agent.
- On a schedule, use Freshdesk "Search Tickets" (e.g. `status:2 AND priority:4`) to pull urgent open tickets, then **Google Sheets** "Add Row" to log each into a triage dashboard.
