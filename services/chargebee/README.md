# Chargebee FlowRunner Extension

FlowRunner service for [Chargebee](https://www.chargebee.com/), the subscription billing and revenue management platform. Manage customers, item-based subscriptions, invoices, the product catalog, payment sources, credit notes and hosted checkout pages through the Chargebee API v2.

## Ideal Use Cases

- Onboard new customers and spin up item-based subscriptions from a signup form or CRM record.
- Automate revenue operations: create ad-hoc invoices, void invoices, collect payment, and review credit notes.
- Manage the subscription lifecycle — pause, resume, cancel, and reactivate — in response to business events.
- Generate hosted checkout pages so customers can self-serve payment and complete a purchase.
- Sync the product catalog (items and item prices) and retrieve invoice PDFs for accounting workflows.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Site | Yes | Your Chargebee site name — the subdomain in `{site}.chargebee.com` (e.g. `acme` for `acme.chargebee.com`). |
| API Key | Yes | Your Chargebee API key. Find it in **Chargebee → Settings → Configure Chargebee → API Keys**. |

### Authentication

Requests use HTTP Basic authentication with the API key as the username and an empty password
(`Authorization: Basic base64("{apiKey}:")`). The base URL is `https://{site}.chargebee.com/api/v2`.

### Request encoding

Chargebee expects request bodies as **`application/x-www-form-urlencoded`**, not JSON (responses
are JSON). Nested objects and arrays are flattened into Chargebee's bracket notation, which this
service handles automatically:

- Nested object: `billing_address[first_name]=John`
- Array of objects (transposed by field and index):
  `subscription_items[item_price_id][0]=basic-USD-monthly` and
  `subscription_items[quantity][0]=1`

GET requests apply the same flattening to query/filter parameters (e.g. `email[is]`,
`customer_id[is]`, `status[is]`).

### Pagination

List operations accept a `Limit` and an `Offset`. Responses include a `next_offset` token; pass
that value back as the `Offset` parameter to retrieve the next page.

## List of Actions

### Customers
- Create Customer
- List Customers
- Get Customer
- Update Customer
- Delete Customer

### Subscriptions
- Create Subscription
- Get Subscription
- List Subscriptions
- Update Subscription
- Cancel Subscription
- Pause Subscription
- Resume Subscription
- Reactivate Subscription

### Invoices
- List Invoices
- Get Invoice
- Create Invoice For Customer
- Void Invoice
- Collect Payment
- Get Invoice PDF

### Product Catalog (Items & Item Prices)
- List Items
- Get Item
- List Item Prices
- Get Item Price

### Payment Sources
- List Payment Sources
- Get Payment Source

### Credit Notes
- List Credit Notes
- Get Credit Note

### Hosted Pages
- Create Checkout

## Dictionaries
- **Get Customers Dictionary** — search customers by email for customer-ID parameters.
- **Get Item Prices Dictionary** — search active item prices for subscription item-price selection.

## Agent Ideas

- When a new signup arrives, use **Chargebee** "Create Customer" then "Create Subscription", and send a welcome email with **Gmail** "Send Message" that includes the hosted checkout link from "Create Checkout".
- After **Chargebee** "Get Invoice PDF" produces a download URL, use **Gmail** "Send Message" to deliver the invoice to the customer, and log the invoice with **Google Sheets** "Add Row" for reconciliation.
- Mirror billing records into accounting by pairing **Chargebee** "List Customers" and "List Invoices" with **QuickBooks Online** "Create Customer" and "Create Invoice".
