# Freshservice FlowRunner Extension

Connect FlowRunner to Freshservice, Freshworks' IT service management (ITSM) platform, to automate the full ITSM lifecycle across tickets, changes, problems, releases, CMDB assets, agents, and requesters via the Freshservice API v2. Authentication uses HTTP Basic auth with your API key.

## Ideal Use Cases

- Auto-create and triage service desk tickets from monitoring alerts, forms, or inbound messages
- Keep an external system of record in sync by reading and updating tickets, changes, and problems
- Coordinate change management and releases across teams from a single workflow
- Sync the CMDB by creating and updating assets programmatically
- Onboard requesters and route work to the right agents and groups
- Notify stakeholders whenever a new ticket is opened

## List of Actions

- **Tickets** — Create Ticket, Get Ticket, List Tickets, Update Ticket, Delete Ticket, Restore Ticket, Reply to Ticket, Add Note
- **Conversations** — List Conversations
- **Changes** — Create Change, Get Change, List Changes, Update Change, Delete Change
- **Problems** — Create Problem, Get Problem, List Problems, Update Problem, Delete Problem
- **Releases** — Create Release, Get Release, List Releases
- **Assets** — Create Asset, Get Asset, List Assets, Update Asset, Delete Asset
- **Agents** — List Agents, Get Agent, Get Current Agent
- **Requesters** — Create Requester, Get Requester, List Requesters, Update Requester
- **Groups** — List Groups

## List of Triggers

- On New Ticket (polling)

## Configuration

- **Domain** — Your Freshservice domain, the subdomain only (e.g. `acme` for `acme.freshservice.com`).
- **API Key** — Your Freshservice API key, found under Profile Settings → Your API Key. Sent as HTTP Basic auth in the form `base64('apiKey:X')`.

## Notes

- **Friendly labels for enum fields**: Priority, status, source, urgency, impact, risk, change type, and release type accept human-readable labels that are mapped to the integer codes Freshservice expects (e.g. ticket priority `Low`/`Medium`/`High`/`Urgent` → `1`/`2`/`3`/`4`; ticket status `Open`/`Pending`/`Resolved`/`Closed` → `2`/`3`/`4`/`5`). Status codes differ per record type — ticket, change, problem, and release statuses use separate integer scales.
- **Custom/type fields**: Ticket and requester custom fields are set via Custom Fields (keys must match the field names configured in your account, e.g. `cf_order_id`); asset type-specific attributes are passed via Type Fields.
- **List Tickets 30-day window**: Without the Updated Since filter, only tickets created in the past 30 days are returned.
- **Assets use display ID**: Asset Get/Update/Delete operations use the display ID shown in the Freshservice UI, not the internal database ID.
- **On New Ticket** establishes a baseline on its first run and does not emit historical tickets.

## Agent Ideas

- When a **PagerDuty** "Create Incident" fires for an outage, use Freshservice "Create Ticket" to open a linked service desk ticket and "Add Note" with the incident details for the on-call team.
- When the Freshservice "On New Ticket" trigger fires, use **Slack** "Send Message To Channel" to alert the support channel with the ticket subject, priority, and requester.
- Use **Freshdesk** "Get Ticket" to pull a customer-facing conversation, then call Freshservice "Create Problem" to open an internal root-cause investigation referencing it.
