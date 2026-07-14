# Mailjet FlowRunner Extension

Send transactional and bulk emails through the Mailjet Send API v3.1 and manage your Mailjet contacts, contact lists, templates and delivery statistics. Authenticate with a Mailjet API Key and Secret Key combined into HTTP Basic auth against `https://api.mailjet.com`.

## Ideal Use Cases

- Send transactional emails (receipts, notifications, password resets) with HTML content, attachments and stored templates
- Deliver up to 50 personalized messages in a single bulk send
- Keep a synchronized contact database, subscribe contacts to lists and set custom properties
- Monitor deliverability by pulling message events, histories and aggregated statistics

## List of Actions

### Email Sending

- Send Email
- Send Bulk Emails

### Contacts

- Create Contact
- Delete Contact
- Get Contact
- List Contacts
- Update Contact
- Update Contact Properties

### Contact Lists

- Create Contact List
- List Contact Lists
- Manage List Subscription

### Templates

- List Templates

### Messages & Statistics

- Get Message
- Get Message History
- Get Stat Counters
- List Messages

## List of Triggers

This service does not define any triggers. Mailjet's Event API delivers webhooks to endpoints configured manually in the Mailjet UI, which does not fit FlowRunner's automatic webhook lifecycle. Use List Messages or Get Message History for polling-style flows.

## Configuration

- **API Key** — Mailjet API Key used for HTTP Basic authentication (required)
- **Secret Key** — Mailjet Secret Key used for HTTP Basic authentication (required)

## Notes

- Send Email attachments are downloaded from their URLs and embedded as base64; keep the total message under Mailjet's 15 MB limit.
- Sandbox Mode validates a message without delivering it (no `MessageID` is generated).
- Sender addresses/domains must be validated in Mailjet before sending.
- Delete Contact uses the GDPR-compliant v4 endpoint and requires the numeric contact ID; deletion is permanent.
- Contact properties must already be defined in the account before Update Contact Properties can assign values.
- List operations return `{ count, total, data }` mapped from Mailjet's `{ Count, Total, Data }` envelope.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires with a subscription request, use **Mailjet** "Manage List Subscription" to add the sender to a contact list, then **Mailjet** "Send Email" to deliver a welcome message from a stored template
- Use **Google Sheets** "Get Rows" to read a mailing roster, then call **Mailjet** "Create Contact" and "Update Contact Properties" for each row to sync subscribers into Mailjet
- After **Mailjet** "Send Bulk Emails", periodically call **Mailjet** "Get Stat Counters" and log delivered, opened and bounced counts to **Google Sheets** "Add Row" for a campaign performance report
