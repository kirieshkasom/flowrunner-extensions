# Postmark FlowRunner Extension

FlowRunner integration for [Postmark](https://postmarkapp.com), the transactional email delivery service. Send single, templated, and batch emails; browse templates and message streams; search outbound messages and bounces; manage suppression lists; and read delivery statistics. Authenticates with a Postmark Server API Token sent as the `X-Postmark-Server-Token` header.

## Ideal Use Cases

- Send transactional emails (receipts, password resets, notifications) with open and link tracking, tags, and file attachments from FlowRunner file URLs.
- Deliver templated emails driven by a variable model, or dispatch up to 500 messages in a single batch call.
- Search and inspect sent messages, including the full delivery/open/click event timeline for a given message.
- Monitor deliverability via outbound overview and delivery statistics, and triage bounces.
- Manage message-stream suppression lists and reactivate bounced recipient addresses.

## List of Actions

### Email Sending
- Send Batch Emails
- Send Email
- Send Email with Template

### Templates
- Get Template
- List Templates

### Outbound Messages
- Get Message Details
- Search Outbound Messages

### Statistics
- Get Delivery Stats
- Get Outbound Overview

### Bounces
- Activate Bounce
- Get Bounce
- Search Bounces

### Suppressions
- Create Suppression
- Delete Suppression
- List Suppressions

### Message Streams
- List Message Streams

## List of Triggers

This service does not define any triggers. Postmark delivers bounce, delivery, open, click, spam-complaint, and subscription-change events via webhooks configured in the Postmark UI (Server → your stream → Settings → Webhooks); point them at your own endpoint for event-driven flows.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Server API Token | Yes | In Postmark, open your **Server → API Tokens** tab and copy the Server API token. It is sent as the `X-Postmark-Server-Token` header. |

> Note: this integration covers **server-level** operations only. Account-level operations (managing servers, domains, and sender signatures) use a different, account-level token and are not included.

## Notes

- Attachment URLs are downloaded server-side and base64-encoded; Postmark's total message size limit is 10 MB (batch payload limit is 50 MB).
- Date filters (`fromdate`/`todate`) are interpreted by Postmark in US Eastern Time.
- Message history retention depends on your Postmark plan (45 days by default).
- Batch sends and suppression create/delete return per-item results; check each item's `ErrorCode` (or status) because individual entries can fail while the call itself succeeds.

## Agent Ideas

- When an **Airtable** "On New Record" trigger fires for a new customer, use **Postmark** "Send Email with Template" to deliver a personalized welcome email rendered from the record's fields.
- On a new order in **Stripe**, call **Stripe** "Get Invoice" and then **Postmark** "Send Email" to email the customer their receipt with the invoice PDF attached.
- Periodically call **Postmark** "Search Bounces", then use **Google Sheets** "Add Rows" to log each bounced recipient into a deliverability tracking sheet for follow-up.
- When **Postmark** "Get Delivery Stats" shows a spike in inactive addresses, post an alert to a team channel with **Slack** "Send Message To Channel".
