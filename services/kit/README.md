# Kit (ConvertKit) FlowRunner Extension

FlowRunner integration for [Kit](https://kit.com) — the creator email marketing platform **formerly known as ConvertKit** (the product was renamed in 2024; if you are searching for a ConvertKit integration, this is it). Built on the Kit **v4 API**, it manages subscribers, tags, forms, sequences, custom fields, and broadcasts, and reacts in realtime to Kit webhook events. Authentication uses a Kit v4 API key sent in the `X-Kit-Api-Key` header (get it in Kit under Settings → Developer → API Keys (v4)).

## Ideal Use Cases

- Sync new leads from forms, stores, or spreadsheets into Kit and tag them for the right automation.
- Keep subscriber records current — update custom fields, unsubscribe cancelled contacts, and manage tag membership.
- Enroll subscribers into email sequences or add them to forms to trigger incentive emails.
- Draft or schedule broadcasts and pull open/click stats for reporting.
- Kick off cross-app workflows whenever a subscriber activates, is tagged, completes a sequence, clicks a link, or makes a purchase.

## List of Actions

### Account
- Get Account

### Subscribers
- Create Subscriber
- Get Subscriber
- List Subscribers
- Update Subscriber
- Unsubscribe Subscriber

### Tags
- Create Tag
- List Tags
- Tag Subscriber
- Tag Subscriber By Email
- Remove Tag From Subscriber
- List Subscribers For Tag

### Forms
- List Forms
- Add Subscriber To Form

### Sequences
- List Sequences
- Add Subscriber To Sequence

### Custom Fields
- List Custom Fields
- Create Custom Field

### Broadcasts
- List Broadcasts
- Create Broadcast
- Get Broadcast
- Get Broadcast Stats

## List of Triggers

- On Kit Event (realtime) — fires on a chosen Kit webhook event: Subscriber Activated, Subscriber Unsubscribed, Subscriber Bounced, Subscriber Complained, Tag Added, Tag Removed, Form Subscribed, Sequence Subscribed, Sequence Completed, Link Clicked, or Purchase Created. Tag, Form, Sequence, and Link URL are only required for their matching events.

## Configuration

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key | Yes | Your Kit v4 API key. Get it in Kit under Settings → Developer → API Keys (v4). |

## Notes

- **Pagination**: List operations are cursor-paginated. They return a `pagination` object (`start_cursor`, `end_cursor`, `has_next_page`, `has_previous_page`); pass `end_cursor` as the *After Cursor* parameter to fetch the next page (up to 500 items per page).
- **Dictionaries**: Tag, Form, and Sequence pickers are backed by dictionaries so you can select items by name.
- **Webhooks**: The service registers one Kit webhook per trigger and removes it when the trigger is deleted. Because Kit deliveries do not echo the event name, the callback URL is stamped with the event and trigger identifiers at registration time to route inbound deliveries.
- **API Reference**: [Kit API v4 documentation](https://developers.kit.com/v4).

## Agent Ideas

- When a **Kit** "On Kit Event" trigger fires for a Purchase Created event, use **Slack** "Send Message To Channel" to alert the team with the subscriber's email and purchase details.
- Use **Google Sheets** "On New Row" to capture new leads from a spreadsheet, then call **Kit** "Create Subscriber" and "Tag Subscriber By Email" to add and segment each one for the right automation.
- When a **Shopify** "On New Customer" trigger fires, use **Kit** "Create Subscriber" to add them to the mailing list and **Kit** "Add Subscriber To Sequence" to start a welcome course.
- When a **Kit** "On Kit Event" trigger fires for Subscriber Activated, use **Google Sheets** "Add Row" to log the new subscriber into a growth-tracking spreadsheet.
