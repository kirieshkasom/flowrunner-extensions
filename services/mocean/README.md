# Mocean FlowRunner Extension

Send SMS messages, run two-factor (2FA) verification flows, look up phone number carrier and portability information, and monitor your account balance and pricing through the [MoceanAPI](https://moceanapi.com/) network. Authentication uses your MoceanAPI API Key and API Secret, added automatically to every request.

## Ideal Use Cases

- Send transactional or notification SMS to one or many recipients as part of a workflow
- Deliver one-time PINs for 2FA login and confirm the code a user entered
- Validate a phone number and detect its carrier or whether it has been ported before messaging
- Monitor prepaid balance and per-country SMS pricing to control spend

## List of Actions

### SMS

- Send SMS

### Verify

- Send Verification Code
- Check Verification Code
- Resend Verification Code

### Number Lookup

- Number Lookup

### Account

- Get Balance
- Get Pricing

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** (required) — your MoceanAPI key from MoceanAPI → Dashboard → API key
- **API Secret** (required) — your MoceanAPI secret from MoceanAPI → Dashboard → API secret

Every request is authenticated with the `mocean-api-key` and `mocean-api-secret` credentials plus `mocean-resp-format=json`, all added automatically. Recipient numbers use international MSISDN format (no leading `+` or `00`). All Mocean request fields use the `mocean-*` prefix internally; operation inputs use friendly names (e.g. From, To, Text) that are mapped to the corresponding `mocean-*` keys.

## Agent Ideas

- When a **Slack** "On New Member" trigger fires, use **Mocean** "Send Verification Code" then "Check Verification Code" to run a phone-based 2FA step before granting access.
- Use **Airtable** "Get Records" to pull a contact list, run **Mocean** "Number Lookup" on each number to filter out invalid or ported numbers, then "Send SMS" to the validated recipients.
- On a **HubSpot** "Create Contact", use **Mocean** "Send SMS" to text a welcome message, calling "Get Balance" first to confirm sufficient prepaid funds.
