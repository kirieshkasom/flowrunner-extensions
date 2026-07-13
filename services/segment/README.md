# Segment FlowRunner Extension

Manage your entire Segment workspace with the Segment Public (management) API - Sources,
Destinations, Tracking Plans, Warehouses, Destination Filters, Functions, Engage Audiences
(schedules, previews, destination connections, activations), Unify Computed Traits and Space
Filters, Reverse ETL, Profiles Sync, Selective Sync, Live Plugins, dbt, Transformations,
Deletion & Suppression, Delivery Overview metrics, IAM (users, invites, groups, roles), Labels,
Audit Trail, Usage, and Customer Insights - no code, with searchable dropdowns for every
resource. It also sends live events to Segment's Tracking API (data plane) - Track, Identify,
Group, Page, Screen, Alias, and Batch.

Management and config actions authenticate with a Segment Public API token (set as the API Token
config item, sent as `Authorization: Bearer`). The Tracking actions instead send events to
Segment's Tracking API using a per-source Write Key (set as the optional Source Write Key config
item, sent over HTTP Basic auth); find it in Segment under Connections > Sources > [your source] >
Settings > API Keys. The Write Key is only required if you use the Tracking actions.

## Ideal Use Cases

- Provision Sources and connect them to Destinations, Warehouses, and Reverse ETL models.
- Build, schedule, preview, and activate Engage Audiences and Unify Computed Traits.
- Govern data: run Deletion & Suppression regulations, manage IAM users/groups/roles and Labels.
- Monitor delivery, API-call usage, and the audit trail - and react when new audit events occur.

## List of Actions

- Workspace: Get Workspace
- Sources / Destinations / Destination Filters: Create, Get, List, Update, Delete
- Tracking Plans / Warehouses / Functions: Create, Get, List, Update, Delete
- Spaces: List, Get
- Audiences: Create, Get, List, Update, Delete, Execute Run; Schedules, Previews, Destination
  Connections, Activations, Supported Destinations
- Computed Traits / Space Filters: Create, Get, List, Update, Delete
- Reverse ETL: Models (Create, Get, List, Update, Delete) + Syncs (Create, Get Status, List, Cancel)
- Profiles Sync: warehouses (Create, List, Update, Delete) + Selective Syncs (List, Update)
- Selective Sync: Advanced Sync Schedule (Get, Replace), List Syncs, Update Selective Sync
- Live Plugins: Create, Get Latest, Delete Code
- dbt: Create dbt Model Sync
- Transformations: Create, Get, List, Update, Delete
- Deletion & Suppression: Create (Workspace/Source/Cloud Source) Regulation, List, Get, List Suppressions
- Delivery Overview: Egress/Ingress Success & Failed, Filtered at Source/Destination metrics
- IAM: Users, Invites, User Groups, Roles (list/get/create/update/delete/permissions/members)
- Labels: Create, List, Delete
- Audit Trail: List Audit Events
- Usage: Get Daily Workspace / Per-Source API Calls
- Customer Insights: Create Download
- Tracking (data plane): Track Event, Identify User, Group User, Track Page View, Track Screen
  View, Alias User, Send Batch Events

## List of Triggers

- New Audit Event (polling) - fires when a new audit-trail event occurs in the workspace.

## Plan & Feature Gates

Some actions require the matching Segment plan/feature: Protocols (Tracking Plans), Functions,
Engage (Audiences), Unify (Computed Traits, Space Filters), Reverse ETL, Profiles Sync, Selective
Sync, Live Plugins, Transformations, and Customer Insights. Calls without the entitlement return a
permission error. Regulation and user/invite deletes are destructive.

## Agent Ideas

- When a **Segment** "New Audit Event" trigger fires for a destructive change, use **PagerDuty** "Create Incident" to page the on-call owner about the workspace configuration change.
- Poll **Segment** "New Audit Event" and post each event to a governance channel with **Slack** "Send Message To Channel" so the data team has a live audit feed.
- Pull usage with **Segment** "Get Daily Workspace API Calls" (or "Get Daily Per Source API Calls") and append the numbers to a tracking sheet via **Google Sheets** "Add Row" for month-over-month reporting.
- When a new lead is captured, use **Segment** "Identify User" to set their traits and "Track Event" to record the signup, feeding the customer profile that downstream Destinations consume.
