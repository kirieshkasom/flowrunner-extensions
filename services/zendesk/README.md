# Zendesk FlowRunner Extension

Automate your Zendesk support desk: create, update, search, and comment on tickets, manage end users and organizations, look up agents and groups, and react to tickets being created or updated in real time - all from a no-code flow.

## Ideal Use Cases
- Open tickets from other systems (forms, chat, e-commerce orders) with the right priority, assignee, group, tags, and custom fields.
- Triage support: search tickets with Zendesk's query syntax, reassign them, change status, and post public replies or internal notes.
- Keep customer data in sync by creating and updating end users and organizations from your CRM or billing system.
- Escalate urgent tickets to Slack, email, or an on-call tool the moment they are created or updated.
- Log ticket activity into spreadsheets or databases for reporting.

## Setup
1. In Zendesk Admin Center, go to **Apps and integrations → APIs → Zendesk API** and enable **Token access**, then add an API token.
2. Configure the service with:
   - **Subdomain** - the `yourcompany` part of `yourcompany.zendesk.com`
   - **Email** - the agent email address the API token belongs to
   - **API Token** - the token created above

## List of Actions
- Tickets: Create Ticket, Get Ticket, List Tickets, Update Ticket, Add Comment To Ticket, Delete Ticket, Search Tickets, List Ticket Comments
- Users: Create User, Get User, Search Users, Update User, List Agents
- Organizations: Create Organization, List Organizations, Get Organization

## List of Triggers
- On Ticket Event (Ticket Created / Ticket Updated) - real-time, delivered via a Zendesk webhook plus a business-rule trigger that the extension provisions and removes automatically.

## Agent Ideas
- When a **Zendesk** "On Ticket Event" trigger fires for an urgent ticket, use **Slack** "Send Message To Channel" to alert the on-call channel with the subject, requester, and ticket link.
- When a **Zendesk** "On Ticket Event" trigger fires, use **Google Sheets** "Add Row" to log the ticket's ID, subject, status, priority, and assignee into a reporting spreadsheet.
- Use **Zendesk** "Search Users" to find a customer by email, then call **Zendesk** "Create Ticket" and **Gmail** "Send Message" to open a support ticket and email the customer a confirmation with the ticket number.
