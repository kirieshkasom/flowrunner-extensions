# PayPal FlowRunner Extension

Integrate [PayPal](https://www.paypal.com/) with FlowRunner to process orders and payments, manage
invoices and subscriptions, and send batch payouts across the Checkout, Payments, Invoicing,
Billing, and Payouts APIs.

## Ideal Use Cases

- Accept a payment by creating and capturing (or authorizing) a Checkout order, then refunding or voiding it later.
- Automate invoicing: draft, send, track, and record payments against invoices for the merchant account.
- Manage recurring revenue by creating subscriptions and activating, suspending, or cancelling them.
- Pay out to many recipients at once (contractors, affiliates, refunds) with a single batch payout.

## Authentication

This service uses PayPal's OAuth 2.0 **client credentials** flow. There is no user redirect — you
supply your app's Client ID and Secret once, and the service obtains and caches an access token
automatically (PayPal tokens live about 9 hours; the service refreshes them before they expire).

### Getting your credentials

1. Sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Go to **Apps & Credentials**.
3. Toggle between **Sandbox** and **Live** to match the environment you want to use.
4. Open your app (or create one) and copy the **Client ID** and **Secret**.

## Configuration

| Setting         | Required | Description                                                                                 |
| --------------- | -------- | ------------------------------------------------------------------------------------------- |
| `Client ID`     | Yes      | Your app's Client ID from the PayPal Developer Dashboard.                                    |
| `Client Secret` | Yes      | Your app's Secret from the PayPal Developer Dashboard.                                       |
| `Environment`   | Yes      | `Sandbox` for testing or `Live` for real transactions. Credentials differ per environment.  |

> **Sandbox vs. Live:** Sandbox and Live have separate credentials and separate base URLs
> (`api-m.sandbox.paypal.com` vs. `api-m.paypal.com`). Always develop and test against Sandbox
> before switching the `Environment` setting to `Live`.

## List of Actions

### Orders (Checkout v2)

- Create Order
- Get Order
- Capture Order
- Authorize Order

### Payments (v2)

- Get Captured Payment
- Refund Captured Payment
- Get Authorized Payment
- Capture Authorized Payment
- Void Authorized Payment

### Invoicing (v2)

- Create Draft Invoice
- Send Invoice
- Get Invoice
- List Invoices
- Cancel Invoice
- Generate Invoice Number
- Delete Invoice
- Record Payment

### Subscriptions (Billing v1)

- Create Subscription
- Get Subscription
- Activate Subscription
- Suspend Subscription
- Cancel Subscription
- List Plans
- Get Plan

### Payouts (v1)

- Create Batch Payout
- Get Payout Batch

## List of Triggers

This service does not define any triggers.

## Notes

- **Idempotency:** Write operations accept an optional **Idempotency Key** (sent as PayPal's
  `PayPal-Request-Id` header) so retries do not create duplicate charges, orders, or payouts. When
  omitted, the service generates one automatically per call.
- **Error handling:** API errors surface PayPal's `message`, the individual issue descriptions, and
  the `debug_id`. Keep the `debug_id` when contacting PayPal support — they use it to trace the request.

## Agent Ideas

- When a **WooCommerce** "On Order Created" trigger fires, use PayPal "Create Order" and "Capture Order" to collect payment, then **Gmail** "Send Message" to email the buyer a confirmation.
- Use **QuickBooks Online** "Get Invoice" to pull an unpaid invoice's line items, call PayPal "Create Draft Invoice" and "Send Invoice" to bill the customer, then log the sent invoice id with **Google Sheets** "Add Row".
- After a PayPal "Get Payout Batch" reports a batch as SUCCESS, use **Slack** "Send Message To Channel" to notify the finance team and **Google Sheets** "Add Row" to record each recipient's payout status.
