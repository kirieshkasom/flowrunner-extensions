# Odoo FlowRunner Extension

Interact with any [Odoo](https://www.odoo.com/) instance over its External API. This service is a generic ORM client: every operation works against **any Odoo model** (e.g. `res.partner`, `sale.order`, `product.product`, `crm.lead`) by passing the model's technical name. It talks to Odoo over zero-dependency JSON-RPC and authenticates with your Odoo API key used in place of a password.

## Ideal Use Cases

- Sync CRM contacts, leads, or partners from external tools into Odoo
- Create or update sales orders, invoices, and products from automated workflows
- Query Odoo data with domain filters to feed reports, notifications, or downstream systems
- Count or paginate large record sets efficiently without fetching every row
- Discover a model's available fields before building create/update payloads
- Trigger Odoo workflow actions (confirm order, post message, custom methods) via arbitrary calls

## List of Actions

### Records

- Search Read
- Search
- Search Count
- Read
- Create
- Update
- Delete

### Metadata

- Fields Get

### Advanced

- Call Method

## Configuration

| Item          | Description                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------- |
| Instance URL  | Your Odoo instance URL, e.g. `https://mycompany.odoo.com` (a trailing slash is stripped).     |
| Database      | The Odoo database name (for Odoo Online, usually your subdomain).                             |
| Username      | Your Odoo login, usually your email address.                                                  |
| API Key       | An Odoo API key used in place of your password (Preferences → Account Security → New API Key). |

> Note: External API access requires an appropriate Odoo plan, and Odoo Online users may need to set an account password before generating API keys.

## Notes

### Authentication & call flow

On the first operation of an execution the service calls the `common` service's `authenticate` method with `[db, username, apiKey, {}]`, which returns your numeric **uid** (cached for the invocation). Every subsequent model operation goes through the `object` service's `execute_kw`:

```
execute_kw(db, uid, apiKey, model, method, positionalArgs, kwargs)
```

All requests are `POST`ed to `{url}/jsonrpc`.

### Domain syntax

Search operations filter with a **domain**: an array of condition **triples** in the form `[field, operator, value]`.

```json
[["is_company", "=", true]]
[["name", "ilike", "Acme"], ["customer_rank", ">", 0]]
[["id", "in", [7, 18, 12]]]
```

- Multiple triples are combined with an implicit **AND**.
- For explicit logic, add prefix operators as their own elements: `["|", ["state","=","draft"], ["state","=","sent"]]` (OR), `"&"` (AND), `"!"` (NOT).
- Common operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `like`, `ilike`, `in`, `not in`.
- An empty domain (`[]`) matches every record (subject to `limit`).

### Values & fields

**Create**/**Update** take a values object mapping field names to values, e.g. `{"name":"Acme Inc","is_company":true}`. For relational fields, pass IDs (many2one) or Odoo command tuples (one2many/many2many). Use **Fields Get** to discover which fields a model exposes.

### Errors

Odoo JSON-RPC returns `{ "result": ... }` on success or `{ "error": { "data": { "message", "debug" } } }` on failure. The service surfaces `error.data.message` (with the last line of `debug` and the HTTP status when available) as the thrown error.

### Triggers

This service defines no triggers.

## Agent Ideas

- When a **HubSpot** "Create Contact" fires, call **Odoo** "Create" on `res.partner` to mirror the contact into Odoo, then **Odoo** "Search Read" to confirm it landed
- Use **Odoo** "Search Read" on `sale.order` to pull recent orders, then **Google Sheets** "Add Row" to log each order into a reporting spreadsheet
- After **Odoo** "Update" (or "Call Method" with `action_confirm`) marks an order confirmed, use **Slack** "Send Message To Channel" to notify the fulfillment team with the record ID
