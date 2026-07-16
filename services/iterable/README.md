# Iterable FlowRunner Extension

Integrate [Iterable](https://iterable.com), a cross-channel marketing platform, with FlowRunner. Manage users, track events, work with lists and campaigns, send triggered email and push messages, and read email templates.

## Authentication

This service authenticates with an Iterable **server-side API key**, sent on the `Api-Key` request header.

1. In Iterable, go to **Settings → API Keys**.
2. Create a new key of type **Server-side**.
3. Copy the key into the service's **API Key** configuration field.

### Data center (region)

Iterable operates separate US and EU data centers. Set the **Data Center** configuration field to match your account:

- **US** (default) — requests go to `https://api.iterable.com/api`.
- **EU** — requests go to `https://api.eu.iterable.com/api`.

If your Iterable account is hosted in the EU and you leave this on US, requests will fail. When in doubt, keep the default of **US**.

## Configuration

| Field | Required | Description |
| --- | --- | --- |
| API Key | Yes | A server-side API key from Iterable → Settings → API Keys. |
| Data Center | No | `US` (default) or `EU`. EU accounts use `api.eu.iterable.com`. |

## User identity

By default, users in Iterable are **email-keyed** — most operations identify a user by their email address. Projects can also be configured to be `userId`-based; where an operation accepts both, provide either an email or a userId (at least one is required).

## Operations

### Users
- **Update User** — create or update a single profile by email or userId, with data fields and optional nested-object merging.
- **Get User** — fetch a profile by email or userId.
- **Delete User** — permanently delete a profile by email.
- **Bulk Update Users** — create or update many profiles in one request.
- **Update Subscriptions** — set a user's email list, channel, and message-type subscriptions.
- **Get User Fields** — list the project's user field schema.

### Events
- **Track Event** — record a single custom event for a user.
- **Track Bulk Events** — record many custom events in one request.

### Lists
- **Get Lists** — list all lists in the project.
- **Create List** — create a new static list.
- **Delete List** — delete a list by ID.
- **Subscribe to List** — add users to a list.
- **Unsubscribe from List** — remove users from a list.
- **Get List Users** — get the emails on a list.
- **Get List Size** — get the number of users on a list.

### Messaging
- **Send Email** — send a triggered email using an existing campaign.
- **Send Push** — send a triggered push notification using an existing campaign.

### Campaigns
- **List Campaigns** — list all campaigns.
- **Get Campaign Metrics** — get aggregate performance metrics (CSV) for campaigns.

### Templates
- **List Email Templates** — list email templates, optionally filtered by type and medium.
- **Get Email Template** — fetch a single email template by ID.

## Notes

- Write operations return Iterable's `{ code, msg, params }` wrapper; a `code` other than `Success` is surfaced as an error.
- Some read endpoints (Get List Users, Get Campaign Metrics) return plain text/CSV, which this service wraps in an object (`emails` / `metrics`).

## Agent Ideas

- When a **Segment** "New Audit Event" trigger fires, call **Iterable** "Track Event" to record the corresponding activity against a user profile so downstream campaigns can react to it.
- Use **Customer.io** "Search Customers" to pull a cohort of people, then call **Iterable** "Bulk Update Users" to sync their profiles and "Subscribe to List" to add them to a targeted Iterable list.
- When an **Iterable** "Send Email" send succeeds, use **Slack** "Send Message To Channel" to post a confirmation with the campaign details into a marketing operations channel.
