# Revolut Business FlowRunner Extension

Integration with the Revolut Business banking API for moving money and reading account data. Look up accounts and balances, manage saved recipients (counterparties), read and cancel transactions, transfer between your own accounts, make payments, prepare payment drafts, exchange currencies, create payout links, and manage webhook subscriptions — all through a single OAuth2-connected service. Connects to either the Production or Sandbox environment.

## Ideal Use Cases

- Automating outgoing payments and payroll runs to saved recipients
- Reconciling transactions and multi-currency balances into accounting tools or spreadsheets
- Verifying a UK recipient's account details (Confirmation of Payee) before paying
- Running treasury and foreign-exchange workflows across currencies
- Sending payout links to people you cannot reach by bank transfer
- Reacting in real time to incoming transactions or payout-link status changes

## List of Actions

### Accounts
- List Accounts
- Get Account
- Get Account Bank Details

### Counterparties
- List Counterparties
- Get Counterparty
- Create Counterparty
- Delete Counterparty
- Validate Account Name (UK Confirmation of Payee)

### Transactions
- List Transactions
- Get Transaction
- Get Transaction By Request ID
- Cancel Transaction

### Transfers
- Transfer Between Own Accounts
- Make Payment

### Payment Drafts
- List Payment Drafts
- Get Payment Draft
- Create Payment Draft
- Delete Payment Draft

### Foreign Exchange
- Get Exchange Rate
- Exchange Money

### Payout Links
- List Payout Links
- Get Payout Link
- Create Payout Link
- Cancel Payout Link

### Webhooks
- List Webhooks
- Get Webhook
- Create Webhook
- Update Webhook
- Delete Webhook
- Rotate Webhook Signing Secret
- List Failed Webhook Events
- Check Webhook Is Genuine

## List of Triggers

- On Transaction Created
- On Transaction State Changed
- On Payout Link Created
- On Payout Link State Changed

## Authentication

This service uses **OAuth2** with a JWT private-key client assertion. Upload your security certificate in the Revolut Business app, then connect the account from the connection settings before using any action.

## Configuration

- **Environment** (required) — `production` for live banking or `sandbox` for testing against fake balances. Defaults to `production`.
- **Client ID** (required) — the identifier Revolut Business shows after you upload your security certificate (Settings → APIs).
- **Private Key** (required) — the private key paired with the uploaded certificate. Paste the whole block, including the BEGIN and END lines. Treat it like a password.
- **Issuer Host** (required) — the host part of the OAuth redirect URL registered in your Revolut Business app (for example `your-flowrunner-host.com`), with no `https://` prefix and no path.

## Agent Ideas

- When a **Revolut Business** "On Transaction Created" trigger fires, use **Google Sheets** "Add Row" to log the payment into a reconciliation sheet, then **Gmail** "Send Message" to alert the finance team.
- Use **Xero** "Get Invoices" to pull unpaid supplier bills, then call **Revolut Business** "Create Counterparty" and "Make Payment" to pay each one.
- When a **Revolut Business** "On Payout Link State Changed" trigger reports a link as processed, use **Slack** "Send Message To Channel" to notify the operations channel.
