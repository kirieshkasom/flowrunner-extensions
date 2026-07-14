# MSG91 FlowRunner Extension

Integrate [MSG91](https://msg91.com) with FlowRunner to send SMS, one-time passwords (OTP),
WhatsApp messages, and transactional email, and to check your account balance.

MSG91 is an India-focused communications platform. Because of TRAI DLT regulations, SMS to
Indian numbers cannot be sent as free-form text — you must send through **approved templates**
(called **Flows**). This service reflects that model: you reference an approved template/flow ID
rather than passing raw message text.

## Ideal Use Cases

- Deliver and verify OTPs for login, signup, or transaction confirmation via SMS or voice call.
- Send transactional SMS (order updates, alerts) through DLT-approved Flows/templates.
- Send WhatsApp Business notifications from an approved template.
- Send transactional email from a verified sending domain using an approved template.
- Monitor per-product credit balances and trigger low-balance alerts.

## List of Actions

### Account
- Get Balance

### Email
- Send Email

### OTP
- Resend OTP
- Send OTP
- Verify OTP

### SMS
- Send SMS

### WhatsApp
- Send WhatsApp Message

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses an **Auth Key**, sent on every request as the `authkey` header.

| Config item | Required | Description |
|-------------|----------|-------------|
| Auth Key    | Yes      | Your MSG91 Auth Key. Find it in the MSG91 panel under **Settings → API → Auth Key**. |

All calls are made against the v5 API base `https://control.msg91.com/api/v5`.

## The Flow / template & DLT model

MSG91 does not send arbitrary SMS content. Instead:

1. In the MSG91 panel, create a **Flow** (SMS template) with placeholder variables such as
   `##name##` or `##otp##`.
2. Register and get the template **DLT-approved** (mandatory for delivery to Indian numbers).
3. Note the **Template/Flow ID** and use it in the **Send SMS** action.
4. Provide each recipient's variable values in the **Recipients** list.

The same approval model applies to **OTP** (OTP templates), **WhatsApp** (approved WhatsApp
Business templates), and **Email** (email templates on a verified sending domain).

### Mobile number format

Numbers must be in international format, with the country code and **no** `+` or leading zeros —
for example `919812345678` for an Indian number.

## Operations

### SMS
- **Send SMS** — Sends an SMS via an approved Flow/template. Provide the Template/Flow ID and a
  list of recipient objects, each with a `mobiles` value (one or more comma-separated numbers)
  plus keys matching the Flow's variables. Returns the MSG91 request ID for delivery tracking.

### OTP
- **Send OTP** — Sends an OTP to a mobile number using an approved OTP template. If you omit the
  OTP value, MSG91 auto-generates one; you can control length and expiry.
- **Verify OTP** — Validates the code a user entered against what was sent to their number.
- **Resend OTP** — Re-sends the most recent OTP as either a text message or a voice call.

A typical OTP flow: **Send OTP** → user receives and enters the code → **Verify OTP**. Use
**Resend OTP** if the code did not arrive.

### WhatsApp
- **Send WhatsApp Message** — Sends a WhatsApp message from your integrated WhatsApp Business
  number using an approved template, with ordered body parameters filling the template placeholders.

### Email
- **Send Email** — Sends a transactional email using an approved template on a verified sending
  domain, with a key/value map of template variables.

### Account
- **Get Balance** — Returns remaining credits for a given product (SMS, WhatsApp, Email, Voice).

## Notes

- Template IDs, sender IDs, WhatsApp templates, and email templates are all account-specific and
  must be created and approved in the MSG91 panel. They are entered as free-text values in the
  relevant actions.
- Responses follow MSG91's `{ "type": "success" | "error", "message": ... }` shape; errors are
  surfaced with the API's message.

## Agent Ideas

- When a **Shopify** "Get Order" returns a placed order, use **MSG91** "Send SMS" to text the customer an order-confirmation via an approved Flow, then **MSG91** "Send WhatsApp Message" for shipment updates.
- Use **MSG91** "Send OTP" to text a verification code during a **HubSpot** "Create Contact" signup flow, then "Verify OTP" before persisting the lead.
- On a low-credit condition detected by **MSG91** "Get Balance", use **Google Sheets** "Add Row" to log the balance and **Slack** "Send Message To Channel" to alert the ops team.
