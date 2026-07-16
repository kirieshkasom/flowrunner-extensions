# Demio FlowRunner Extension

FlowRunner service for [Demio](https://demio.com), the webinar and virtual event platform. This integration wraps the Demio Public API v1 (`https://my.demio.com/api/v1`) so you can list webinars, inspect scheduled sessions, register participants, and pull per-session participant and attendance data directly from your FlowRunner flows.

## Ideal Use Cases

- Automatically register leads captured elsewhere into an upcoming Demio webinar session
- Sync webinar registrants and attendees into a CRM or marketing list
- Pull post-webinar analytics for reporting and engagement follow-up
- Look up a webinar's scheduled session dates to schedule reminders around them

## List of Actions

### Events

- List Events
- Get Event
- Get Event Session

### Registration

- Register Participant

### Participants

- List Session Participants

## List of Triggers

This service does not define any triggers.

## Authentication

Demio uses a two-part API key/secret credential, sent on every request as HTTP headers:

- `Api-Key: <apiKey>`
- `Api-Secret: <apiSecret>`

**Where to find them:** in Demio, go to **Settings → Integrations → Public API**. Copy the **API Key** and **API Secret** shown there. Both config items are configured per connection (`shared: false`) and are required.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| `apiKey`    | Yes      | Your Demio Public API Key (sent as the `Api-Key` header). |
| `apiSecret` | Yes      | Your Demio Public API Secret (sent as the `Api-Secret` header). |

## The event → date → register flow

Demio webinars are modeled as **events**, and each event has one or more scheduled **sessions** identified by a `date_id`. To register someone, you resolve the event, pick a session, then register:

1. **List Events** (or the *Get Events Dictionary* picker) to find the event `id` of an upcoming webinar.
2. **Get Event** for that event and read its `dates` array to get the `date_id` (and optional details via **Get Event Session**) of the session you want.
3. **Register Participant** with the participant's `name` and `email` (both required) plus the event `id` and session `date_id` (or a registration ref URL), and any optional fields — last name, company, website, phone number, GDPR consent, or custom fields. The participant receives their unique join link.

After the event, use **List Session Participants** (keyed by the session's `date_id`, with an optional attendance status filter) to see who registered and who attended.

The **Get Events Dictionary** picker (a dictionary method, not a standalone action) supplies the event `id` used by the operations above.

## Error handling

API failures surface the Demio response `message` (or `errors`) along with the HTTP status code, e.g. `Demio API error: Event not found (status 404)`.

## Agent Ideas

- Use **HubSpot** "Search Contacts" to find leads matching a segment, then call **Demio** "Register Participant" to enroll each one in an upcoming webinar session and capture their join link.
- After a webinar, call **Demio** "List Session Participants" (filtered by status) and use **Gmail** "Send Message" to email attendees a recording link and non-attendees a replay invitation.
- Use **Demio** "Get Event" to read the next session's start time from its `dates` array, then use **Google Calendar** "Create Event" to add a team reminder before the webinar begins.
