# Cal.com FlowRunner Extension

FlowRunner integration for [Cal.com](https://cal.com), the open-source scheduling platform. Manage bookings, event types, availability slots, and schedules, and trigger flows in real time when Cal.com events occur.

## Ideal Use Cases

- Automatically book, reschedule, or cancel Cal.com meetings from an inbound form, CRM, or chat message.
- Sync new and cancelled bookings into a spreadsheet, database, or notification channel.
- Confirm or decline bookings that require approval as part of an automated review flow.
- Look up open availability slots and create a booking at the first free time.
- Kick off onboarding, reminder, or follow-up workflows the moment a Cal.com event fires.

## List of Actions

### Bookings
- Cancel Booking
- Confirm Booking
- Create Booking
- Decline Booking
- Get Booking
- List Bookings
- Mark Absent
- Reschedule Booking

### Event Types
- Create Event Type
- Delete Event Type
- Get Event Type
- List Event Types
- Update Event Type

### Availability
- Get Available Slots

### Schedules
- Get Schedule
- List Schedules

### Account
- Get My Profile

## List of Triggers

- On Cal.com Event (realtime, `SINGLE_APP`) — fires when the selected Cal.com event is delivered. Supported events: Booking Created, Booking Cancelled, Booking Rescheduled, Booking Requested, Booking Rejected, Booking Paid, Meeting Started, Meeting Ended, Recording Ready, Form Submitted.

## Authentication

This service uses a Cal.com **API key**.

1. In Cal.com, go to **Settings → Developer → API keys**.
2. Create a new API key (it starts with `cal_`).
3. Paste it into the service's **API Key** configuration field.

Requests are authenticated with `Authorization: Bearer <apiKey>` against the Cal.com API v2 base URL `https://api.cal.com/v2`.

### A note on API version headers

Cal.com's v2 API is date-versioned: most endpoints require a `cal-api-version` header carrying a dated version string. This service sends the correct version per endpoint automatically:

| Area | `cal-api-version` |
| --- | --- |
| Bookings (list, get, create, cancel, reschedule, confirm, decline, mark absent) | `2024-08-13` |
| Event Types, Slots, Schedules, Me | `2024-06-14` |
| Webhooks (used by the trigger) | none — webhooks carry their own `version` field |

Cal.com v2 responses are wrapped as `{ "status": "...", "data": ... }`; this service unwraps and returns the `data` payload.

## Notes

- The **On Cal.com Event** trigger registers a Cal.com webhook (`POST /webhooks`) whose subscriber URL points at the flow's callback, and removes it when the trigger is disabled (`DELETE /webhooks/{id}`). Each delivery is flattened to expose the booking UID, title, status, times, event type, attendees, and organizer, with the raw `payload` preserved.
- **Get My Profile** returns the API key's user and is useful as a connection check.

## Agent Ideas

- When the **Cal.com** "On Cal.com Event" trigger fires for a new booking, use **Slack** "Send Message To Channel" to post the attendee, time, and event type to a scheduling channel.
- Use **Cal.com** "Get Available Slots" to find the next open time, then "Create Booking" to schedule the meeting, and log it with **Google Sheets** "Add Row".
- When the **Cal.com** "On Cal.com Event" trigger fires for a cancellation, use **Gmail** "Send Message" to email the host a rebooking link.
