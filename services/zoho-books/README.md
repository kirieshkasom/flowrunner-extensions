# Zoho Books FlowRunner Extension

Integration with Zoho Books, Zoho's online accounting platform. Manage contacts, items, invoices, estimates, sales and purchase orders, bills, expenses, customer and vendor payments, credit notes, and recurring invoices through a single OAuth2-connected service. Works across any Zoho data center and emits realtime webhook and polling triggers for accounting events.

## Ideal Use Cases

- Automating invoice, estimate, and recurring-billing creation when orders or milestones complete
- Syncing customers, vendors, and items between Zoho Books and other systems
- Recording customer and vendor payments and reconciling outstanding balances
- Capturing vendor bills and expenses from parsed documents or receipts
- Managing the order-to-cash and procure-to-pay lifecycle, from sales/purchase orders to invoices/bills
- Reacting in real time to new invoices, payments, contacts, and bills via webhooks

## List of Actions

### Contacts
- Create Contact
- Get Contact
- Update Contact
- Delete Contact
- List Contacts

### Items
- Create Item
- Get Item
- Update Item
- Delete Item

### Estimates
- Create Estimate
- Get Estimate
- Update Estimate
- Delete Estimate
- Mark Estimate Accepted
- Mark Estimate Declined
- Convert Estimate To Invoice

### Sales Orders
- Create Sales Order
- Get Sales Order
- Update Sales Order
- Delete Sales Order
- Mark Sales Order Open
- Mark Sales Order Void

### Invoices
- Create Invoice
- Get Invoice
- Update Invoice
- Delete Invoice
- List Invoices
- Mark Invoice Sent
- Submit Invoice
- Approve Invoice
- Email Invoice
- Void Invoice
- Write Off Invoice

### Customer Payments
- Record Customer Payment
- Get Customer Payment
- Delete Customer Payment

### Credit Notes
- Create Credit Note
- Get Credit Note
- Update Credit Note
- Delete Credit Note
- Apply Credit Note To Invoices

### Recurring Invoices
- Create Recurring Invoice
- Get Recurring Invoice
- Update Recurring Invoice
- Delete Recurring Invoice
- Activate Recurring Invoice
- Stop Recurring Invoice

### Bills
- Create Bill
- Get Bill
- Update Bill
- Delete Bill
- Mark Bill Open
- Mark Bill Void

### Vendor Payments
- Record Vendor Payment

### Purchase Orders
- Create Purchase Order
- Get Purchase Order
- Update Purchase Order
- Delete Purchase Order
- Mark Purchase Order Issued
- Mark Purchase Order Cancelled

### Expenses
- Create Expense
- Get Expense
- Update Expense
- Delete Expense
- List Expenses

## List of Triggers

### Realtime (webhook)
- On Invoice Created (Realtime)
- On Invoice Updated (Realtime)
- On Invoice Deleted (Realtime)
- On Payment Created (Realtime)
- On Contact Created (Realtime)
- On Contact Updated (Realtime)
- On Estimate Accepted (Realtime)
- On Bill Created (Realtime)
- On Bill Paid (Realtime)

### Polling
- On New Or Updated Invoice (Polling)
- On New Or Updated Contact (Polling)
- On New Or Updated Customer Payment (Polling)
- On New Or Updated Bill (Polling)

## Authentication

This service uses **OAuth2**. Connect a Zoho account from the connection settings before using any action. The data center is auto-detected from the accounts server returned during the consent flow, so a single Multi-DC client works across regions.

## Configuration

- **Client ID** (required) — OAuth 2.0 Client ID from the Zoho API Console (https://api-console.zoho.com).
- **Client Secret** (required) — OAuth 2.0 Client Secret issued alongside the Client ID.
- **Data Center** — default Zoho region for the initial OAuth redirect (`US`, `EU`, `IN`, `AU`, `JP`, `CA`, `CN`, `SA`). Defaults to `US`; multi-DC accounts are auto-detected on callback.
- **Default Organization ID** — optional fallback organization_id used when an action does not specify one. Find IDs in Zoho Books > Settings > Organization.

## Agent Ideas

- When **Stripe** "Create Charge" processes a payment, call **Zoho Books** "Record Customer Payment" to apply it against the matching invoice and keep accounts receivable reconciled.
- When a **Parseur** "On Document Processed" trigger emits a parsed vendor invoice, use **Zoho Books** "Create Bill" to record the payable, then **Slack** "Send Message To Channel" to flag it for approval.
- When a **Zoho Books** "On Invoice Created (Realtime)" trigger fires, use **Gmail** "Send Message" to email the customer and **Google Sheets** "Add Row" to log it in a revenue tracker.
