# Unleashed Software FlowRunner Extension

Connects FlowRunner to the Unleashed Software cloud inventory management platform. Requests are authenticated with an API ID plus an HMAC-SHA256 signature computed over the request query string (no OAuth flow), sent via the `api-auth-id` and `api-auth-signature` headers. The extension reads products, stock on hand, customers, suppliers, warehouses, sales orders, and purchase orders, and can create new sales orders. Paginated endpoints use Unleashed's page-in-path pagination and unwrap the response `Items` array into a flat list alongside `Pagination` metadata.

## Ideal Use Cases

- Sync the product catalog and warehouse-level stock levels into other systems or dashboards
- Look up customers, suppliers, and stock availability before fulfilling an order
- Automatically create Unleashed sales orders from incoming orders in a store or CRM
- Monitor sales and purchase order status as part of an order-fulfillment workflow

## List of Actions

### Products

- Get Products
- Get Product

### Stock

- Get Stock On Hand
- Get Stock On Hand by Product

### Customers

- Get Customers
- Get Customer

### Suppliers

- Get Suppliers

### Sales Orders

- Get Sales Orders
- Get Sales Order
- Create Sales Order

### Purchase Orders

- Get Purchase Orders

### Warehouses

- Get Warehouses

## List of Triggers

This service does not define any triggers.

## Configuration

Unleashed uses an API ID plus an API Key with HMAC request signing — there is no OAuth flow. Both values are found in Unleashed under Integration → Unleashed API.

- **API ID** (`apiId`) — sent as the `api-auth-id` header.
- **API Key** (`apiKey`) — the secret used to sign each request.

### How requests are signed

Every request computes `HMAC-SHA256(queryString, apiKey)`, base64-encodes it, and sends it as `api-auth-signature`. The signature is computed over **only** the query string exactly as it appears after the `?` (the empty string when there are no query parameters) — not the path or body.

### Pagination

Unleashed puts the page number in the URL path (e.g. `GET /Products/2`); filters and page size go in the signed query string. List operations unwrap the envelope's `Items` array into a flat list and return the `Pagination` metadata alongside it.

## Notes

- Zero npm dependencies — signing uses Node's built-in `crypto`.
- On error, the service surfaces the Unleashed response `description` (or raw body) along with the HTTP status.

## Agent Ideas

- Use **Unleashed Software** "Get Stock On Hand by Product" to confirm availability, then call **ShipBob** "Create Order" to fulfill the order only when sufficient inventory exists.
- After **ShipBob** "On Order Shipped" fires, call **Unleashed Software** "Create Sales Order" to record the fulfilled order against the customer in the inventory system.
- Use **Unleashed Software** "Get Customers" to retrieve a customer record, then call **QuickBooks Online** "Create Customer" to sync the account into accounting before invoicing.
