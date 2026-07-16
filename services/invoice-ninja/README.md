# Invoice Ninja FlowRunner Extension

Connect FlowRunner to the [Invoice Ninja](https://www.invoiceninja.com/) v5 API to manage clients, invoices, payments, products, quotes and recurring invoices. Authenticates with an `X-Api-Token` header and works against both the hosted app (`https://invoicing.co`) and self-hosted installs. Invoices and quotes are built from `line_items` (product key, description, unit cost, quantity and optional per-line tax), and invoice/quote lifecycle changes run through Invoice Ninja's bulk-action endpoints.

## Ideal Use Cases

- Create a client and issue an invoice automatically when a deal closes or an order is placed.
- Record incoming payments and apply them to specific invoices from your billing workflow.
- Email an invoice to a client, mark it sent or paid, or archive it as a follow-up step.
- Generate quotes for new leads and approve them once the client accepts.
- Sync a product catalog and keep recurring invoices in view for reporting.

## List of Actions

### Clients

- Create Client
- Delete Client
- Get Client
- List Clients
- Update Client

### Invoices

- Create Invoice
- Delete Invoice
- Get Invoice
- Invoice Action
- List Invoices
- Update Invoice

### Payments

- Create Payment
- Get Payment
- List Payments

### Products

- Create Product
- Get Product
- List Products
- Update Product

### Quotes

- Approve Quote
- Create Quote
- List Quotes

### Recurring Invoices

- List Recurring Invoices

## List of Triggers

This service does not define any triggers.

## Configuration

- **URL** (required) — Your Invoice Ninja base URL: `https://invoicing.co` for the hosted app, or your self-hosted domain (e.g. `https://billing.example.com`) without `/api/v1`. Any trailing slash is stripped automatically and all requests target `{URL}/api/v1`.
- **API Token** (required) — Create one under Invoice Ninja → Settings → Account Management → API Tokens. Sent on every request as the `X-Api-Token` header (alongside `X-Requested-With: XMLHttpRequest`).

## Notes

- Records are identified by an opaque **hashed id** (e.g. `Wpmbk5ezJn`), not a numeric id. Deletes are soft deletes and can be restored from the Invoice Ninja UI.
- **Line items** (`line_items`) carry `product_key`, `notes` (description), `cost` (unit price), `quantity` and optional `tax_name1`/`tax_rate1`. Supplying line items on Create/Update Invoice or Create Quote replaces the full set; supplying `contacts` on Update Client replaces the full contact list (the first contact is primary).
- **Invoice Action** and **Approve Quote** call the bulk endpoints, passing the record id as a single-element `ids` array; Invoice Action supports emailing, marking sent/paid, archiving, restoring, cancelling and deleting.
- Many endpoints accept an `include` parameter (e.g. `include=contacts`, `include=client,payments`) to embed related records. List endpoints wrap results in `{ data, meta.pagination }`; single-record endpoints return `{ data }`. A `Get Clients Dictionary` picker backs client-selection parameters. Validation errors (HTTP 422) surface the message plus per-field details.

## Agent Ideas

- When a **Stripe** "Get Payment Intent" confirms a charge, call **Invoice Ninja** "Create Payment" to record the amount and apply it against the matching invoice.
- Use **Pipedrive** "Get Deal By ID" to pull a won deal, then chain **Invoice Ninja** "Create Client" and "Create Invoice" to bill the customer, and **Gmail** "Send Message" to notify them.
- After **Invoice Ninja** "Approve Quote" marks a quote accepted, use **Slack** "Send Message To Channel" to alert the sales team and "Create Invoice" to bill the client.
