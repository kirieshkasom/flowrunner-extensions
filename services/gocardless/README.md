# GoCardless FlowRunner Extension

Collect and manage bank-to-bank payments through GoCardless: set up Direct Debit mandates, take one-off, recurring, and instalment payments, issue refunds, and reconcile payouts. Includes hosted and own-page authorisation flows, mandate migration, and polling triggers that react to account events.

## Ideal Use Cases

- Onboarding customers and setting up Direct Debit mandates
- Taking one-off, subscription, and instalment-plan payments
- Automating recurring billing and retrying failed payments
- Issuing refunds and reconciling payouts to your bank account
- Collecting bank details through a hosted or own-page flow
- Migrating existing mandates from another provider in bulk
- Reacting to payment, mandate, and payout events for automation

## List of Actions

- Add Mandate Import Entry
- Cancel Billing Request
- Cancel Instalment Schedule
- Cancel Mandate
- Cancel Mandate Import
- Cancel Payment
- Cancel Subscription
- Collect Bank Account (Own Pages)
- Collect Customer Details (Own Pages)
- Confirm Payer Details
- Create Billing Request
- Create Customer
- Create Hosted Flow URL
- Create Instalment Schedule
- Create Mandate
- Create Mandate Import
- Create Payment
- Create Refund
- Create Subscription
- Disable Customer Bank Account
- Finalise Billing Request
- Get Billing Request
- Get Creditor
- Get Customer
- Get Customer Bank Account
- Get Event
- Get Instalment Schedule
- Get Mandate
- Get Mandate Import
- Get Mandate PDF
- Get Payment
- Get Payout
- Get Refund
- Get Subscription
- List Creditors
- List Customer Bank Accounts
- List Customers
- List Events
- List Instalment Schedules
- List Mandate Import Entries
- List Mandates
- List Payments
- List Payout Items
- List Payouts
- List Refunds
- List Subscriptions
- Lookup Bank
- Pause Subscription
- Reinstate Mandate (UK Bacs)
- Remove Customer
- Resume Subscription
- Retry Payment
- Run Test Scenario (Sandbox Only)
- Save Customer Bank Account
- Submit Mandate Import
- Test Connection
- Update Creditor
- Update Customer
- Update Mandate Notes
- Update Payment
- Update Subscription

## List of Triggers

- When a Billing Request Event Happens
- When a Mandate Event Happens
- When a Payment Event Happens
- When a Payout Event Happens
- When a Refund Event Happens
- When a Subscription Event Happens

## Agent Ideas

- When a GoCardless **"When a Payment Event Happens"** trigger fires, use Gmail **"Send Message"** to email the customer a receipt or a failed-payment notice, then log the outcome with Google Sheets **"Add Row"**.
- Use Google Sheets **"Get Rows"** to read a list of new subscribers, then call GoCardless **"Create Customer"** and **"Create Subscription"** to set each up on recurring Direct Debit billing.
- When a GoCardless **"When a Payout Event Happens"** trigger fires, call QuickBooks Online **"Create Payment"** to reconcile the bank transfer and post Slack **"Send Message To Channel"** to alert your finance channel.
