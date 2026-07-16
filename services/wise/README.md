# Wise FlowRunner Extension

Integrate [Wise](https://wise.com) (formerly TransferWise) with FlowRunner to manage profiles, create quotes and recipients, send and fund international transfers, and read balances, exchange rates, and supported currencies via the Wise Platform API.

## Ideal Use Cases

- Automate cross-border payouts to vendors, contractors, or employees at real mid-market rates.
- Quote a currency conversion and send a funded transfer end to end from a workflow.
- Sync new payees into Wise as recipient accounts before paying them.
- Monitor multi-currency balances and current exchange rates for reporting or alerting.
- Track transfer status and cancel transfers that have not yet been processed.

## Getting started: profile IDs come first

Almost every operation is scoped to a **profile** (your personal account, or a business account). Run **List Profiles** first — it returns your `personal` and `business` profiles and their numeric IDs — and use one of those IDs as the `Profile ID` on the other operations. The Get Profiles dictionary powers the Profile ID selectors throughout the service.

## Typical transfer flow

Sending money is a four-step sequence:

1. **Create Quote** — provide source/target currencies and either a source or target amount. Returns the rate, fees, and a quote `id` (UUID).
2. **Create Recipient Account** (once per payee) — create the payee with its currency, type (e.g. IBAN, sort code, email), holder name, and a raw `details` object whose fields vary by currency/type. Returns the recipient's numeric `id`. Existing recipients can be found with **List Recipient Accounts**.
3. **Create Transfer** — combine the recipient id (`targetAccount`) and the quote id (`quoteUuid`), with an optional reference. This creates the transfer in an unfunded state.
4. **Fund Transfer** — pays the transfer from your Wise multi-currency **balance** (payment type `BALANCE`), which actually moves the money.

Use **Get Transfer** / **List Transfers** to track status, and **Cancel Transfer** to cancel one that has not yet been processed.

### About `customerTransactionId`

Create Transfer uses a `customerTransactionId` (a UUID v4) as an **idempotency key**: sending the same value again safely retries without creating a duplicate transfer. You can pass your own value, or leave the parameter empty and the service generates one for you. For guaranteed idempotency across retries, supply and persist your own UUID.

## List of Actions

### Profiles

- List Profiles
- Get Profile

### Quotes

- Create Quote
- Get Quote

### Recipients

- Create Recipient Account
- List Recipient Accounts
- Get Recipient Account
- Delete Recipient Account

### Transfers

- Create Transfer
- Get Transfer
- List Transfers
- Cancel Transfer
- Fund Transfer

### Balances

- Get Account Balances

### Rates

- Get Exchange Rate

### Currencies

- List Currencies

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Type | Required | Description |
| --- | --- | --- | --- |
| **API Token** | String | Yes | A Wise API token. Create one under **Wise → Settings → API tokens** (a personal token; business and platform tokens also work). Sent as `Authorization: Bearer <token>`. |
| **Environment** | Choice | Yes | `Sandbox` (default) targets `https://api.sandbox.transferwise.tech` for testing with a sandbox token; `Live` targets `https://api.wise.com` for production. |

Create a **sandbox** token at [sandbox.transferwise.tech](https://sandbox.transferwise.tech) to try the integration end to end before switching to Live.

## Notes

- Recipient `details` fields differ per currency/type (e.g. `iban` for EUR IBAN accounts, `sortCode` + `accountNumber` for GBP). See the Wise Platform "Recipient account requirements" documentation for the exact schema per currency/type.
- Quotes expire; create a quote shortly before creating the transfer that uses it.
- Funding via **Fund Transfer** requires sufficient funds in the matching source-currency balance.

## Agent Ideas

- When a **Stripe** "Create Refund" or payout event needs to reach an external bank account, use **Wise** "Create Quote", "Create Transfer", and "Fund Transfer" to send the funds internationally at the mid-market rate.
- Read new vendor bills with **Xero** "Get Invoices", create matching payees via **Wise** "Create Recipient Account", then quote and pay them with "Create Quote" and "Create Transfer".
- After **Wise** "Fund Transfer" completes, use **Google Sheets** "Add Row" to log the transfer id, amount, and recipient, and **Slack** "Send Message To Channel" to notify the finance team.
