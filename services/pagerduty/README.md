# PagerDuty FlowRunner Extension

Automate on-call incident response with PagerDuty. Create and manage incidents, run the full
lifecycle (acknowledge, resolve, snooze, merge, note, status update, escalate), fire alerts and
change events straight through the Events API v2, and administer the services, escalation
policies, schedules, users, teams, maintenance windows, tags, and business services behind them.
Connects over OAuth 2.0 using a shared Client ID and Client Secret from your PagerDuty app;
dropdown pickers make every service, policy, schedule, user, team, and incident selectable from a
list, with friendly labels (e.g. High/Low urgency, Triggered/Acknowledged/Resolved status,
Admin/Responder/Observer roles) shown instead of raw API values.

## Configuration

- **Client ID** / **Client Secret** (required, shared): OAuth 2.0 credentials from your PagerDuty
  app. OAuth is required by the service because the REST API portion (everything except the Events
  category) authenticates with the connected account's access token.
- **Events API Routing Key** (optional): the Integration Key of an Events API v2 integration on a
  PagerDuty service, used as the default routing key for the Events actions. Each Events action
  also accepts a per-call **Routing Key Override**, so this default is optional.

**Events API v2 note:** the Events actions (Trigger Alert, Acknowledge Alert, Resolve Alert, Send
Change Event) talk to a different host (`events.pagerduty.com`) and use a different auth model than
the rest of the service (the OAuth-authenticated REST API at `api.pagerduty.com`). They authorize
with a routing key carried in the request body rather than the OAuth token — no OAuth token is
needed for the Events actions themselves, only the routing key (from config or the per-call
override). OAuth Client ID/Secret must still be configured, since OAuth remains required for the
REST API portion of the service.

## Ideal Use Cases

- Open an incident automatically when a check or customer report signals an outage.
- Acknowledge, resolve, snooze, or re-assign incidents and post status updates to subscribers.
- Schedule maintenance windows around deploys to suppress expected alert noise.
- Keep schedules, escalation policies, services, and team membership in sync from other systems.
- Look up who is on call now and pull in extra responders during a live incident.

## List of Actions

**Incidents:** Create, List, Get, Update, Merge, Snooze, Create Note, List Notes, Create Status
Update, Create Responder Request, List Alerts, Get Alert, Update Alert, List Log Entries

**Services:** List, Get, Create, Update, Delete

**Escalation Policies:** List, Get, Create, Update, Delete

**Schedules:** List, Get, Create, Update, Delete, List Overrides, Create Override, List On-Calls

**Users:** List, Get, Create, Update, Delete, List Contact Methods, List Notification Rules

**Teams:** List, Get, Create, Update, Delete, Add User, Remove User, Add Escalation Policy,
Remove Escalation Policy

**On-Call:** List On-Calls, List Priorities

**Maintenance Windows:** List, Get, Create, Update, Delete

**Tags:** List, Create, Delete, List Tagged Entities, Change Entity Tags

**Business Services:** List, Get, Create, Update, Delete

**Events:** Trigger Alert, Acknowledge Alert, Resolve Alert, Send Change Event

## List of Triggers

- On New Triggered Incident

## Agent Ideas

- When a **PagerDuty** "On New Triggered Incident" trigger fires, use **Slack** "Send Message To Channel" to alert the on-call channel with the incident title and urgency.
- Use **Google Sheets** "Get Rows" to read a list of degraded services, then call **PagerDuty** "Create Incident" for each row to page the responsible responders.
- When a **PagerDuty** "On New Triggered Incident" trigger fires, use **Gmail** "Send Message" to email stakeholders and log the incident to a tracker with **Google Sheets** "Add Row".
- Read a monitoring export with **Google Sheets** "Get Rows" and call **PagerDuty** "Trigger Alert" for each failing check, reusing a Deduplication Key so recoveries can later be cleared with **PagerDuty** "Resolve Alert".
