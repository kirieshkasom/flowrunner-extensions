# ERPNext FlowRunner Extension

Integrate [ERPNext](https://erpnext.com/) (and any Frappe-based site) with FlowRunner through the Frappe REST and RPC APIs. Perform generic CRUD, querying, and remote-method access across every DocType — Customer, Sales Order, Item, Sales Invoice, Contact, Lead, and any custom DocType in your instance. Authenticates with an API Key / API Secret token pair.

## Ideal Use Cases

- Sync customers, items, or leads between ERPNext and other systems by listing, creating, and updating documents of the matching DocType.
- Automate order-to-cash flows by creating Sales Orders or Sales Invoices and submitting them once they are ready.
- Reverse mistakes or reflect upstream cancellations by cancelling previously submitted documents.
- Look up or count records on demand using Frappe filters to drive branching or reporting logic.
- Trigger custom ERPNext business logic by invoking whitelisted server-side methods.

## List of Actions

### Documents

- Cancel Document
- Create Document
- Delete Document
- Get Document
- List Documents
- Submit Document
- Update Document

### Query

- Count Documents
- Get Value

### Advanced

- Run Method

## List of Triggers

This service does not define any triggers.

## Authentication

The service uses Frappe token-based authentication. Every request is sent with `Authorization: token <API Key>:<API Secret>`.

To get your keys, in ERPNext open **User → (your user) → API Access → Generate Keys**. The **API Key** is shown on the user record; the **API Secret** is shown **only once** at generation time, so copy it immediately.

| Config     | Required | Description |
|------------|----------|-------------|
| Site URL   | Yes      | Your ERPNext site base URL, e.g. `https://mycompany.erpnext.com`. Any trailing slash is stripped. |
| API Key    | Yes      | The API Key generated for your user. |
| API Secret | Yes      | The API Secret shown once when keys are generated. |

## Notes

**The doctype / resource model.** Frappe exposes every record type as a **DocType**, available under `/api/resource/{DocType}`. The `DocType` parameter is free text, so you can target any built-in or custom type by name (case-sensitive, spaces allowed): `Customer`, `Sales Order`, `Item`, `Sales Invoice`, `Contact`, `Lead`, etc. A specific record is addressed by its **name** (the document's primary key / ID), e.g. `SAL-ORD-2024-00001`. Resource endpoints return records under `data`; method endpoints (Count, Get Value, Submit, Cancel, Run Method) return their result under `message`.

**Filters syntax.** List and query operations use Frappe's filter format — a JSON array of `[field, operator, value]` triples combined with AND, e.g. `[["status","=","Open"],["grand_total",">",1000]]`. Supported operators include `=`, `!=`, `>`, `<`, `>=`, `<=`, `like`, `not like`, `in`, `not in`, and `between`. Fields are selected with a JSON array too, e.g. `["name","customer_name","grand_total"]`; pass `["*"]` for all fields.

**Submittable documents.** Submit and Cancel apply only to submittable DocTypes (Sales Order, Sales Invoice, Purchase Order, etc.). **Run Method** can change server state and only works with whitelisted methods — use with care.

**Errors.** Frappe returns validation and permission failures as JSON containing `exc_type` and a `_server_messages` array, and server errors (HTTP 500) as HTML tracebacks. The service extracts and surfaces a clean, single-line message together with the HTTP status code so failures are readable in your flow.

## Agent Ideas

- Use **Shopify** "Get List of Orders" to pull new e-commerce orders, then call **ERPNext** "Create Document" against the Sales Order DocType to record each one in ERPNext.
- After **ERPNext** "Submit Document" finalizes a Sales Invoice, use **QuickBooks Online** "Create Invoice" to mirror the invoice into accounting.
- When **ERPNext** "List Documents" surfaces new Leads, use **Slack** "Send Message To Channel" to alert the sales team with the lead details.
