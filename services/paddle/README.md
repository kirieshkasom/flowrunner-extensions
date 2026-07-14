# Paddle FlowRunner Extension

Manage your billing with [Paddle](https://www.paddle.com), the merchant-of-record platform for SaaS and digital products. This extension uses the current **Paddle Billing** API (not the legacy Paddle Classic API) to manage products, prices, customers, subscriptions, transactions, discounts, and refunds/credits.

## Ideal Use Cases

- Provision a new product and its prices in your Paddle catalog straight from an automation.
- Look up a customer, their subscriptions, and credit balances to answer billing questions.
- Pause, resume, cancel, or change a subscription as part of a lifecycle or retention flow.
- Create ad-hoc transactions and fetch invoice PDFs for manual (invoice) billing.
- Issue refunds or credits (adjustments) against past transactions.
- Create and manage discount codes for promotions.

## List of Actions

**Products**

- Create Product
- List Products
- Get Product
- Update Product

**Prices**

- Create Price
- List Prices
- Get Price
- Update Price

**Customers**

- Create Customer
- List Customers
- Get Customer
- Update Customer
- Get Customer Credit Balances

**Subscriptions**

- List Subscriptions
- Get Subscription
- Update Subscription
- Pause Subscription
- Resume Subscription
- Cancel Subscription

**Transactions**

- List Transactions
- Get Transaction
- Create Transaction
- Get Transaction Invoice PDF

**Discounts**

- List Discounts
- Create Discount
- Get Discount
- Update Discount

**Adjustments**

- Create Adjustment (refund or credit)
- List Adjustments

**Dictionaries** (dynamic pickers): Get Products Dictionary, Get Prices Dictionary, Get Customers Dictionary.

## List of Triggers

This service has no triggers.

## Configuration

| Setting     | Required | Description                                                                                                                        |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| API Key     | Yes      | Your Paddle API key (`pdl_...`), sent as a Bearer token. Get it from Paddle → Developer Tools → Authentication → API keys.          |
| Environment | Yes      | `Sandbox` (default, `sandbox-api.paddle.com`) for testing or `Live` (`api.paddle.com`) for production. Defaults to `Sandbox`.       |

Your API key is environment-specific: a sandbox key only works when Environment is set to `Sandbox`, and a live key only works when it is set to `Live`.

## Notes

- Monetary amounts are expressed in the currency's **lowest denomination** (for example, `1000` = `$10.00` for USD). Currency codes are ISO 4217 (e.g. `USD`, `EUR`, `GBP`).
- List actions use cursor-based pagination. Pass the `after` cursor from a previous response back into the **Cursor** parameter to fetch the next page; when there are no more pages the cursor is empty.
- Create a **Price** with a billing cycle to make it a recurring subscription price, or omit the billing cycle for a one-time price.
- **Pause**, **Resume**, and **Cancel** subscription actions take effect either at the end of the current billing period or immediately.
- **Get Transaction Invoice PDF** returns a temporary, secure download URL that expires after a short period, so download it promptly.
- Adjustments (refunds and credits) apply to billed transactions and may require approval in Paddle before they are processed.

## Agent Ideas

- After **Stripe** or a signup flow captures a lead, use **Paddle** "Create Customer" and "Create Transaction" to bill them and "Get Transaction Invoice PDF" to attach the invoice.
- Combine **Paddle** "List Subscriptions" (status `past_due`) with **Gmail** "Send Message" to run a dunning/retention campaign.
- Use **Paddle** "Create Adjustment" to refund a customer, then **Slack** "Send Message To Channel" to notify the finance channel.
- Pair **Paddle** "Create Discount" with **Airtable** "Create Record" to track promo codes and their usage.
