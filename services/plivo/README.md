# Plivo FlowRunner Extension

FlowRunner integration for [Plivo](https://www.plivo.com/), a cloud communications platform for SMS/MMS messaging, outbound voice calls, and phone number management. Authenticate with your Plivo Auth ID and Auth Token; all calls target the account-scoped base URL `https://api.plivo.com/v1/Account/{authId}`.

## Ideal Use Cases

- Send transactional or notification SMS/MMS to one or many recipients from an automated flow.
- Place outbound voice calls driven by Plivo XML answer URLs.
- Look up delivery status and Call Detail Records for messages and calls.
- Search, buy, and manage rented phone numbers, applications, and Powerpack sender pools.
- Monitor account balance and credits.

## Authentication

Plivo uses HTTP Basic authentication. Provide two configuration items:

| Config item | Description |
| ----------- | ----------- |
| **Auth ID** | Your Plivo Auth ID (Plivo Console → Account → Auth ID). |
| **Auth Token** | Your Plivo Auth Token (shown next to the Auth ID). Keep this secure. |

Requests are authenticated with `Authorization: Basic base64("{authId}:{authToken}")`.

## List of Actions

### Messaging
- **Send SMS** — sends an SMS or MMS. Send to multiple recipients by joining destination numbers with the `<` delimiter (e.g. `12025551111<12025552222`). For MMS, set the message type to `MMS` and supply media URLs. Returns an array of `message_uuid` values, one per recipient.
- **Get Message**
- **List Messages**

### Voice
- **Make Call**
- **Get Call**
- **List Calls**
- **Hangup Call**

### Numbers
- **Search Numbers**
- **Buy Number**
- **List Numbers**
- **Get Number**

### Powerpacks
- **List Powerpacks**

### Applications
- **List Applications**

### Account
- **Get Account Details**

## List of Triggers

This service does not define any triggers.

## Notes

- Phone numbers use E.164 format **without** the leading `+` (e.g. `12025551111`).
- Multiple SMS recipients are separated with the `<` delimiter in the destination field.
- MMS requires the message type set to `MMS` plus one or more publicly accessible media URLs.
- Plivo errors are surfaced as `Plivo API error [status]: <message>` using the API's `error`/`message` fields.

## Agent Ideas

- When a **PagerDuty** incident is escalated, call **Plivo** "Send SMS" to text the on-call engineer, or "Make Call" to trigger an automated voice alert.
- Use **Google Sheets** "Get Rows" to pull a contact list, then **Plivo** "Send SMS" to broadcast a notification to each recipient (joined with the `<` delimiter for multi-recipient sends).
- When **HubSpot** "Create Deal" fires for a high-value opportunity, use **Plivo** "Make Call" to instantly connect a sales rep to the prospect.
