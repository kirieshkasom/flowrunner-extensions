# MessageBird

FlowRunner integration for the [MessageBird](https://bird.com) (now **Bird**) communications
platform. Send SMS and voice messages, verify phone numbers with one-time passwords, look up and
validate numbers, and manage contacts and groups.

> **Bird rebrand:** MessageBird rebranded to **Bird** in 2023. This service targets the classic
> MessageBird REST API at `https://rest.messagebird.com`, which remains available and unchanged.
> Your dashboard and login now live at [bird.com](https://bird.com).

## Ideal Use Cases

- Send transactional or notification SMS to customers and internal teams from your workflows.
- Add phone-number OTP verification (SMS, TTS, or flash call) to sign-up and login flows.
- Validate and enrich phone numbers with lookup and HLR checks before messaging.
- Trigger text-to-speech voice calls for critical alerts and reminders.
- Sync and maintain contacts and groups as an address book for outbound campaigns.
- Monitor account balance and message delivery status.

## Authentication

This service authenticates with a MessageBird/Bird **Access Key** sent on every request as an
`Authorization: AccessKey <accessKey>` header.

### Configuration

| Item         | Required | Description                                                                                     |
| ------------ | -------- | ----------------------------------------------------------------------------------------------- |
| `Access Key` | Yes      | Your Live API access key. Get it in the Bird Dashboard under Developers → API access.           |

To obtain an access key:

1. Sign in to the [Bird Dashboard](https://bird.com).
2. Go to **Developers → API access**.
3. Copy a **Live** access key (test keys are prefixed with `test_` and do not send real traffic).

## Operations

### Messaging

- **Send SMS** — Send an SMS or binary message to one or more recipients with an alphanumeric or
  numeric originator, optional reference, and scheduled delivery.
- **Get Message** — Retrieve a message and its per-recipient delivery status by ID.
- **List Messages** — Page through sent and received messages.

### Voice

- **Send Voice Message** — Place a text-to-speech voice call to one or more recipients with a
  selectable language, voice, and answering-machine behavior.

### Verify (OTP)

- **Send Verification** — Send a one-time password via SMS, text-to-speech, or flash call.
- **Verify Token** — Validate the code entered by the user.
- **Get Verification** — Retrieve the status of a verification request.
- **Delete Verification** — Cancel a verification request.

### Lookup

- **Phone Number Lookup** — Validate a number and get its type, country, and formatted variants.
- **Lookup HLR** — Query the Home Location Register for live network and carrier status.

### Contacts

- **Create Contact**, **Get Contact**, **List Contacts**, **Update Contact**, **Delete Contact** —
  Manage contacts (phone number, name, and up to four custom fields) in your address book.

### Groups

- **List Groups** — Page through contact groups.
- **Add Contact to Group** — Add one or more contacts to a group.
- **Remove Contact from Group** — Remove a contact from a group.

### Account

- **Get Balance** — Retrieve your account balance, payment type, and currency.

## Notes

- Phone numbers should be provided in international format including the country code (e.g.
  `+31612345678`).
- Alphanumeric originators are not supported in all countries and cannot receive replies.
- HLR lookups may incur a charge on your account.

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, use **MessageBird** "Send SMS" to text the
  customer an order confirmation and delivery estimate.
- Before adding a lead to **HubSpot** with "Create Contact", call **MessageBird** "Phone Number
  Lookup" to validate the number, then **MessageBird** "Create Contact" to sync it into your
  address book.
- Use **MessageBird** "Send Verification" and "Verify Token" to OTP-verify a phone number, then
  **Google Sheets** "Add Row" to log the verified sign-up into a tracking spreadsheet.
