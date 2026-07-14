# Vonage FlowRunner Extension

Vonage (formerly Nexmo) integration for SMS, multichannel messaging, two-factor authentication, phone number intelligence, and account management, using API key and secret authentication.

## Authentication

This service authenticates with your Vonage **API key** and **API secret**, both available in the [Vonage API Dashboard](https://dashboard.nexmo.com/) under API settings. Both values are required.

## SMS API vs Messages API

Vonage offers two ways to send a text message, and this service exposes both:

- **Send SMS** uses the legacy Vonage **SMS API** (`rest.nexmo.com/sms/json`). It is the simplest way to send a plain SMS and returns a per-recipient status where `"0"` means success.
- **Send Message (Multichannel)** uses the newer **Messages API** (`api.nexmo.com/v1/messages`), a single endpoint that delivers over SMS, WhatsApp, MMS, Messenger, or Viber and returns a message UUID for tracking.

Use Send SMS for straightforward text messaging; use Send Message when you need WhatsApp or other channels.

## Verify v2 (2FA)

The verification actions use **Vonage Verify v2** (`api.nexmo.com/v2/verify`):

1. **Start Verification** delivers a one-time code over SMS, Voice, Email, or WhatsApp and returns a `request_id`.
2. **Check Verification** validates the code the user entered against that `request_id`.
3. **Cancel Verification** stops an in-progress request.

## Ideal Use Cases

- SMS notifications, alerts, and reminders
- Two-factor authentication (2FA) and one-time passcodes
- Multichannel messaging over WhatsApp, MMS, Messenger, and Viber
- Validating and enriching phone numbers with Number Insight
- Monitoring account balance and listing owned virtual numbers

## List of Actions

### Messaging

- Send SMS
- Send Message (Multichannel)

### Verify

- Start Verification
- Check Verification
- Cancel Verification

### Number Insight

- Number Insight (Basic)
- Number Insight (Standard)

### Numbers

- List Owned Numbers

### Account

- Get Balance

## List of Triggers

This service does not define any triggers.

## Agent Ideas

- When a **HubSpot** "Create Contact" completes, use **Vonage** "Send SMS" to text the new lead a welcome message and follow-up link.
- Use **Vonage** "Start Verification" then "Check Verification" to gate a workflow, and on success call **Google Sheets** "Add Row" to log the verified phone number and timestamp.
- Use **Vonage** "Number Insight (Standard)" to validate and enrich a submitted phone number, then post the carrier and line-type results to a channel with **Slack** "Send Message To Channel".
