# seven FlowRunner Extension

FlowRunner integration for [seven.io](https://www.seven.io) (formerly sms77) — send SMS and voice
calls, look up phone numbers, check delivery status, and manage your account and contacts through
the seven.io gateway. Authenticates with an API key sent on every request as the `X-Api-Key` header.

## Ideal Use Cases

- Send transactional or notification SMS (order updates, alerts, OTP codes) to recipients worldwide
- Place automated text-to-speech voice calls for reminders or urgent notifications
- Validate and enrich phone numbers with Format, CNAM, portability (MNP), or live HLR lookups
- Track delivery of sent messages and react to failures in a workflow
- Monitor account balance and per-country pricing before sending campaigns
- Maintain a seven.io address book of contacts for reuse as SMS recipients

## List of Actions

### Account
- Get Account Balance
- Get Pricing

### Contacts
- Create Contact
- List Contacts

### Lookup
- Number Lookup

### Messaging
- Get SMS Delivery Status
- Send SMS

### Voice
- Send Voice Call

## List of Triggers

This service does not define any triggers.

## Authentication

This service authenticates with an API key sent on every request as the `X-Api-Key` header.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key | Yes | Your seven.io API key. Find it in your seven.io **Dashboard → API key**. |

All requests are made against the base URL `https://gateway.seven.io/api`.

## Sender ID (From)

The optional **Sender ID** on Send SMS controls what the recipient sees as the sender:

- Up to **11 alphanumeric** characters (e.g. `MyBrand`), or
- Up to **16 numeric** digits (e.g. a phone number).

Alphanumeric sender IDs are one-way — recipients cannot reply. Some countries require
pre-registered sender IDs; check seven.io's country regulations if messages are not delivered.

## Status / success codes

seven.io returns a numeric status code in the `success` field of a response. `100` means success;
this service surfaces any other code as an error with its meaning. Common codes:

| Code | Meaning |
| ---- | ------- |
| 100 | SMS accepted by the gateway and is being sent. |
| 101 | Sending to at least one recipient failed. |
| 201 | The sender (from) is invalid. |
| 202 | The recipient number is invalid. |
| 301 | Parameter `to` not set. |
| 305 | Parameter `text` is invalid. |
| 308 | Unknown or unsupported parameter. |
| 401 | Text too long. |
| 402 | This SMS was already sent within the last 180 seconds. |
| 403 | Maximum daily limit for this recipient reached. |
| 500 | Insufficient account credit. |
| 600 | An error occurred during sending. |
| 802 | Invalid label. |
| 900 | Authentication failed — check your API key. |
| 901 | Signature/hash verification failed. |
| 902 | The API key lacks access rights for this endpoint. |
| 903 | The requesting IP address is not whitelisted. |

See the [seven.io API documentation](https://docs.seven.io) for the full list.

## Agent Ideas

- After **Shopify** "On New Order" fires, use **seven** "Send SMS" to text the customer an order confirmation, then "Get SMS Delivery Status" to confirm the notification was delivered.
- Validate a lead's phone number with **seven** "Number Lookup" (HLR/MNP), then create a **HubSpot** "Create Contact" record only when the number is reachable and valid.
- Use **Google Sheets** "Get Rows" to pull a list of pending reminders, call **seven** "Send Voice Call" to deliver each as a text-to-speech message, and "Get Account Balance" to halt the run when credit runs low.
