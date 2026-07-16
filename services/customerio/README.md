# Customer.io FlowRunner Extension

FlowRunner integration for [Customer.io](https://customer.io) — identify people, track events, manage manual segments, send transactional email, trigger broadcasts, and query customer data and campaign metrics.

## Ideal Use Cases

- Sync people and their attributes from another system into Customer.io (upsert on identify).
- Track product/behavioral events that drive event-triggered campaigns and segmentation.
- Send transactional email or fire API-triggered broadcasts as part of a larger workflow.
- Manage hard opt-outs and data-removal requests via suppress/unsuppress.
- Curate manual segment membership in bulk (up to 1000 people per call).
- Pull customer attributes, activity timelines, and campaign performance metrics for reporting.

## Authentication — two APIs, three credentials

Customer.io exposes two separate APIs, each with its own credentials. This service uses both.

| API | Used for | Credentials | Auth |
|---|---|---|---|
| **Track API** | Identify/delete/suppress people, track events, add/remove people in manual segments | **Site ID** + **Track API Key** | Basic (`site_id:api_key`) |
| **App API** | Transactional email, broadcasts, customer search, attributes, activities, segments, campaigns, metrics | **App API Key** | Bearer token |

### Configuration items

- **Site ID** (required) — Customer.io → *Workspace Settings → API Credentials → Tracking API*.
- **Track API Key** (required) — same location, paired with the Site ID.
- **App API Key** (optional) — Customer.io → *Account Settings → App API Keys*. Needed only for App API actions; Track-API-only flows work without it. App API actions throw a clear error if this key is missing.
- **Region** (required, default `US`) — `US` or `EU`. Selects the API hosts:
  - US: `track.customer.io` / `api.customer.io`
  - EU: `track-eu.customer.io` / `api-eu.customer.io`

## List of Actions

### Campaigns
- Get Campaign Metrics
- List Campaigns

### Events
- Track Anonymous Event
- Track Event

### Messaging
- List Transactional Messages
- Send Transactional Email
- Trigger Broadcast

### People
- Delete Person
- Get Customer Attributes
- Identify Person
- List Customer Activities
- Search Customers
- Suppress Person
- Unsuppress Person

### Segments
- Add To Manual Segment
- List Segments
- Remove From Manual Segment

## List of Triggers

This service has no triggers. Customer.io's reporting webhooks are configured at the workspace level in the Customer.io UI (Data & Integrations → Integrations → Reporting Webhooks), not per-consumer via API.

## Notes

- The Track API returns empty bodies on success; those actions return a normalized `{ success: true, ... }` object instead.
- API errors are surfaced from Customer.io's `meta.error` / `errors` response fields.

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, use **Customer.io** "Identify Person" to upsert the buyer's profile, then "Track Event" to record the purchase so it can drive an event-triggered campaign.
- Use **Google Sheets** "On New Row" to detect a new signup, then call **Customer.io** "Identify Person" to add them and "Add To Manual Segment" to enroll them in an onboarding audience.
- After **Customer.io** "Get Campaign Metrics" returns performance data, use **Slack** "Send Message To Channel" to post a daily campaign summary to the marketing channel.
