# MailerLite FlowRunner Extension

Manage MailerLite email marketing directly from FlowRunner: sync subscribers, organize groups, inspect subscriber fields, and build, schedule, and send email campaigns. Authenticates with a MailerLite API key sent as a Bearer token.

## Ideal Use Cases

- Syncing contacts from a CRM, form, or spreadsheet into MailerLite as subscribers
- Adding or removing subscribers from groups to power targeted campaigns and automations
- Creating and scheduling email campaigns from generated HTML content
- Reacting in real time when subscribers are created, updated, unsubscribed, or bounced
- Keeping subscriber data GDPR-compliant with delete and forget operations

## List of Actions

### Subscribers

- Upsert Subscriber
- Get Subscriber
- List Subscribers
- Update Subscriber
- Delete Subscriber
- Forget Subscriber

### Groups

- Create Group
- List Groups
- Delete Group
- Assign Subscriber To Group
- Remove Subscriber From Group

### Fields

- List Fields

### Campaigns

- Create Campaign
- Get Campaign
- List Campaigns
- Schedule Campaign
- Delete Campaign

## List of Triggers

- On Subscriber Event

## Configuration

- **API Key** (required) — Your MailerLite API token. Generate it in MailerLite under **Integrations → MailerLite API**. Sent as a `Bearer` token.

## Notes

- **On Subscriber Event** is a realtime (`SINGLE_APP`) trigger. It fires on Subscriber Created / Updated / Unsubscribed / Added To Group / Spam Reported / Bounced. The service registers a MailerLite webhook per trigger and removes it when the trigger is deleted; batched webhook deliveries are supported.
- Creating a campaign does not send it — use **Schedule Campaign** (Instant or Scheduled). The sender address must be verified in MailerLite, and custom HTML content requires a MailerLite Advanced plan.
- **Forget Subscriber** is destructive: it permanently and irreversibly erases the subscriber's data (30-day grace period). Use **Delete Subscriber** for a regular removal.
- Subscriber listing uses cursor pagination; group and campaign listings use page pagination.

## Agent Ideas

- When a **MailerLite** "On Subscriber Event" trigger fires for a new subscriber, use **Slack** "Send Message To Channel" to notify the marketing team with the subscriber's email and status.
- Use **Google Sheets** "Get Rows" to read a list of contacts, then call **MailerLite** "Upsert Subscriber" for each row to sync them into MailerLite and "Assign Subscriber To Group" to segment them.
- When a **Gmail** "On New Email" trigger captures a signup request, use **MailerLite** "Upsert Subscriber" to add the sender, then "Schedule Campaign" to deliver a welcome campaign.
