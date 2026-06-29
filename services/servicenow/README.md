# ServiceNow FlowRunner Extension

Automate ServiceNow's Now Platform from your flows. This extension wraps the Table API as first-class, CRUD-complete actions over the ITSM tables a business user actually works with — Incidents, Change Requests, Problems, Requested Items, and Users — plus a generic "any table" escape hatch for everything else. Assignees, groups, callers, and catalog items are pickable from dropdowns, and enum fields (impact, urgency, state, risk, type) show plain-English labels instead of raw codes.

Authentication uses OAuth2 (authorization code + refresh) against your own ServiceNow instance, configured with a single Instance URL.

## Ideal Use Cases
- Open, update, reassign, and close incidents automatically from alerts, forms, or chat.
- Create and advance change requests as part of a release or approval workflow.
- File problem records for root-cause tracking behind recurring incidents.
- Submit and fulfill Service Catalog requested items (RITMs) for onboarding or procurement.
- Look up users and groups to route work to the right owner.
- Read or write any other ServiceNow table via the generic Table Record actions.

## List of Actions

### Incidents
- Create Incident
- Get Incident
- List Incidents
- Update Incident
- Delete Incident

### Change Requests
- Create Change Request
- Get Change Request
- List Change Requests
- Update Change Request
- Delete Change Request

### Problems
- Create Problem
- Get Problem
- List Problems
- Update Problem
- Delete Problem

### Requested Items
- Create Requested Item
- Get Requested Item
- List Requested Items
- Update Requested Item
- Delete Requested Item

### Users
- Get User
- List Users
- Create User
- Update User
- Delete User

### Generic Table
- Create Table Record
- Get Table Record
- List Table Records
- Update Table Record
- Delete Table Record

## List of Triggers
- None

## Agent Ideas
- When a **Slack** "On Channel Message" trigger reports an outage in an incidents channel, call **ServiceNow** "Create Incident" to open a ticket and reply with **Slack** "Send Message To Channel" containing the new incident number.
- Mirror a **ServiceNow** "Get Incident" record into engineering tracking by calling **Jira** "Create Issue", keeping the ServiceNow incident as the customer-facing source of truth.
- Use **ServiceNow** "List Incidents" on a schedule and append each record to a reporting spreadsheet with **Google Sheets** "Add Row" for SLA and trend analysis.
