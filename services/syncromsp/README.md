# SyncroMSP FlowRunner Extension

FlowRunner integration for [SyncroMSP](https://syncromsp.com/), the all-in-one PSA, RMM, and
remote-access platform for managed service providers. Manage tickets, customers, contacts, assets,
invoices, and RMM alerts directly from your flows.

## Authentication

This service authenticates with an **API token** sent as a Bearer token, scoped to your Syncro
subdomain.

You must configure two items:

| Config item | Description |
| ----------- | ----------- |
| **Subdomain** | Your Syncro subdomain — e.g. `acme` for `acme.syncromsp.com`. All requests are sent to `https://{subdomain}.syncromsp.com/api/v1`. |
| **API Key** | A Syncro API token. Create one in **Admin → API Tokens → New Token**, granting the permissions required by the operations you plan to use (e.g. Tickets, Customers, Assets). |

The token is sent as `Authorization: Bearer <apiKey>` on every request. Syncro enforces a rate
limit of 180 requests per minute per IP.

## Data model

Syncro is **customer-centric**: most records — tickets, contacts, assets, and invoices — belong to
a **customer**. A customer represents either a business (`business_name`) or an individual
(`firstname` / `lastname`). Contacts are individual people under a customer, and assets are the
devices/equipment that customer owns.

Because so many operations need a customer, this service provides a **Get Customers Dictionary** so
you can search and select a customer from a dropdown instead of typing a raw numeric ID.

**Account-configurable values:** ticket `Status` and `Problem Type` are free-text fields that must
match the labels configured in your own Syncro account (e.g. `New`, `In Progress`, `Resolved` for
status; `Hardware`, `Software`, `Network` for problem type). When omitted on Create Ticket, Syncro
applies your account's default new-ticket status.

## Operations

### Tickets
- **List Tickets** — paginated, filter by search text, customer, or status
- **Get Ticket** — full detail by ID
- **Create Ticket** — subject + customer, with optional problem type, status, priority, description
- **Update Ticket** — change subject, status, priority, or problem type
- **Delete Ticket**
- **Create Ticket Comment** — add a public or hidden comment, optionally suppressing the customer email

### Customers
- **List Customers** — paginated, searchable
- **Get Customer**
- **Create Customer** — business name and/or contact name plus contact details
- **Update Customer**
- **Delete Customer**

### Contacts
- **List Contacts** — optionally scoped to a customer
- **Get Contact**
- **Create Contact** — under a customer
- **Update Contact**

### Assets
- **List Assets** — filter by customer or search text
- **Get Asset**
- **Create Asset** — name + customer, with an optional asset type

### Invoices
- **List Invoices** — optionally scoped to a customer
- **Get Invoice**
- **Create Invoice** — customer + line items

### RMM Alerts
- **List RMM Alerts** — filter by resolved state
- **Update RMM Alert** — resolve and/or mute an alert

### Products
- **List Products** — searchable catalog of products and services

## Pagination

List endpoints return 25 records per page and include a `meta` object:

```json
{ "total_pages": 4, "total_entries": 90, "per_page": 25, "page": 1 }
```

Use the `page` parameter to page through results.

## Errors

API errors surface Syncro's `error` / `errors` response body along with the HTTP status code, for
example: `SyncroMSP API error: Customer not found (HTTP 404)`.

## Agent Ideas

- When a high-priority issue is reported, use **SyncroMSP** "Get Customers Dictionary" and "Create Ticket" to log it, then **Slack** "Send Message To Channel" to alert the on-call technician channel with the new ticket number.
- Use **SyncroMSP** "List RMM Alerts" to pull open alerts, "Update RMM Alert" to resolve handled ones, and **Google Sheets** "Add Row" to append each alert's description, severity, and asset into a monitoring log for reporting.
- After **SyncroMSP** "Create Invoice" generates a customer invoice, use **Gmail** "Send Message" to email the customer their invoice number, total, and balance due.
