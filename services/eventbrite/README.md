# Eventbrite FlowRunner Extension

Manage Eventbrite events, attendees, orders, ticket classes, and venues from your FlowRunner flows via the [Eventbrite API v3](https://www.eventbriteapi.com/v3).

## Ideal Use Cases

- Create and publish events programmatically, including ticket classes and venues
- Sync new attendees and orders into a CRM, spreadsheet, or marketing list
- Automate event lifecycle changes (publish, unpublish, cancel) from upstream triggers
- Look up attendee check-in status, barcodes, and profile answers for on-site tooling
- Report on ticket sales and order status across an organization's events

## Authentication

This service authenticates with an Eventbrite **private token** sent as `Authorization: Bearer <token>`.

| Config Item     | Type   | Required | Description                                                                                                                        |
| --------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Private Token   | STRING | Yes      | Your Eventbrite private token (Account Settings → Developer Links → API Keys → your private token).                                |

## Organization ID

Most write and listing operations are **organization-scoped** and require an `organization_id`. Rather than looking this up manually, these operations expose an **Organization** parameter backed by the **Get Organizations** dictionary (which calls `GET /users/me/organizations/`) so you can search and select. You can also call **Get User** (`GET /users/me/`) to confirm the connected account. The **Get Events** dictionary depends on a selected organization and lists that organization's events for event-scoped operations.

## Create Event: nested body shape

Eventbrite requires a nested `event` object. The **Create Event** action builds this from individual fields:

```json
{
  "event": {
    "name": { "html": "<Name>" },
    "start": { "timezone": "America/New_York", "utc": "2026-09-01T22:00:00Z" },
    "end": { "timezone": "America/New_York", "utc": "2026-09-02T01:00:00Z" },
    "currency": "USD",
    "online_event": false,
    "venue_id": "44445555",
    "category_id": "103"
  }
}
```

Notes:

- **UTC timestamps must end in `Z`** (e.g. `2026-09-01T22:00:00Z`). The same timezone is applied to both `start` and `end`.
- Events are created as **drafts**. Use **Publish Event** to make them live (the event needs at least one ticket class first — see **Create Ticket Class**).
- `venue_id` (from **Create Venue**) and `category_id` (from **List Categories** / the categories dictionary) are optional.
- For paid ticket classes, provide **Cost** as `currency,amount-in-minor-units` (e.g. `USD,2500` for $25.00). For free tickets, set **Free** to `true` and omit the cost.

## Pagination

Eventbrite responses include a `pagination` object with a `continuation` token. To fetch the next page, pass the returned `continuation` value into the operation's **Continuation** parameter. Repeat until `has_more_items` is `false`.

## List of Actions

**Events** — Cancel Event, Create Event, Get Event, List Events, Publish Event, Unpublish Event, Update Event
**Attendees** — Get Attendee, List Attendees
**Orders** — Get Order, List Orders
**Ticket Classes** — Create Ticket Class, Delete Ticket Class, List Ticket Classes, Update Ticket Class
**Venues** — Create Venue, Get Venue, List Venues
**Categories** — List Categories
**Me** — Get User

## List of Triggers

This service does not define any triggers.

## Agent Ideas

- Use **Eventbrite** "List Attendees" to pull an event's attendees, then **Mailchimp** "Add Member To List" to enroll each attendee in a post-event follow-up audience.
- On a schedule, call **Eventbrite** "List Orders" for an organization and use **Google Sheets** "Add Row" to log each new order into a sales-tracking spreadsheet.
- After **Eventbrite** "Publish Event" makes an event live, use **Slack** "Send Message To Channel" to announce it to the team and **Gmail** "Send Message" to notify key stakeholders with the event details.
