# Magento 2 FlowRunner Extension

Integrate [Magento 2 / Adobe Commerce](https://business.adobe.com/products/magento/magento-commerce.html) with FlowRunner. Manage products, orders, customers, categories, and sales documents (invoices, shipments, credit memos) through the Magento REST API (`/rest/V1`).

## Ideal Use Cases

- Sync catalog products and stock levels between Magento and an external system of record.
- Automate order fulfillment: invoice, ship, and comment on orders as they progress.
- Keep customer records in step with your CRM or marketing platform.
- Report on sales activity by querying orders, invoices, shipments, and credit memos with `searchCriteria` filters.
- Manage the category tree and category-to-product assignments programmatically.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Store Base URL** | Yes | Your store base URL, e.g. `https://store.example.com`. Strip any trailing slash. The service appends `/rest/V1` (default store view). |
| **Access Token** | Yes | A Magento access token, sent as `Authorization: Bearer <token>`. |

### Getting an access token

The recommended approach is a Magento Integration:

1. In the Magento Admin, go to **System → Extensions → Integrations**.
2. Click **Add New Integration**, give it a name, and (under **API**) grant the resource access the flows will need (Products, Sales, Customers, Categories).
3. Save, then **Activate** the integration and approve it.
4. Copy the **Access Token** shown after activation and paste it into the **Access Token** config item.

Alternatively you can use an admin bearer token obtained from `POST /rest/V1/integration/admin/token`, but such tokens are short-lived; an Integration access token does not expire and is preferred for automations.

## Filtering lists with searchCriteria

Magento's list endpoints (products, orders, customers, invoices, shipments, credit memos) use a verbose `searchCriteria` query format. To keep this manageable, the list operations accept a simple **Filters** array — each entry is an object with:

- `field` — the attribute to filter on (e.g. `status`, `customer_email`, `created_at`, `name`).
- `value` — the value to compare against. With `like`, include SQL `%` wildcards (e.g. `%bag%`).
- `conditionType` — the comparison operator (optional; defaults to `eq`).

Each filter is placed in its own filter group, so multiple filters combine with **AND** semantics.

### Condition types

| conditionType | Meaning |
| --- | --- |
| `eq` | Equals (default) |
| `neq` | Not equal |
| `like` | Pattern match (use `%` wildcards) |
| `gt` | Greater than |
| `lt` | Less than |
| `gteq` | Greater than or equal |
| `lteq` | Less than or equal |
| `in` | In a comma-separated list |
| `nin` | Not in a comma-separated list |
| `from` | Range start (pair with `to`) |
| `to` | Range end (pair with `from`) |

### Examples

Pending orders, newest first:

```json
{
  "filters": [{ "field": "status", "value": "pending", "conditionType": "eq" }],
  "sortOrders": [{ "field": "created_at", "direction": "DESC" }],
  "pageSize": 20,
  "currentPage": 1
}
```

Products whose name contains "bag":

```json
{
  "filters": [{ "field": "name", "value": "%bag%", "conditionType": "like" }]
}
```

Orders created in a date range (two filters, AND-combined):

```json
{
  "filters": [
    { "field": "created_at", "value": "2023-06-01 00:00:00", "conditionType": "from" },
    { "field": "created_at", "value": "2023-06-30 23:59:59", "conditionType": "to" }
  ]
}
```

## List of Actions

### Products
- Create Product
- Delete Product
- Get Product
- Get Stock Item
- List Products
- Update Product
- Update Stock

### Orders
- Add Order Comment
- Cancel Order
- Create Invoice for Order
- Create Shipment
- Get Order
- Hold Order
- List Orders
- Unhold Order

### Customers
- Create Customer
- Delete Customer
- Get Customer
- List Customers
- Update Customer

### Categories
- Create Category
- Get Category
- Get Products in Category
- List Categories

### Sales Documents
- Get Invoice
- List Credit Memos
- List Invoices
- List Shipments

## List of Triggers

This service does not define any triggers.

## Notes

- Errors surface Magento's message, with parameterized placeholders (`%1`, `%2`, …) interpolated from the response `parameters` when present.
- The service targets the default store view (`/rest/V1`). Endpoints that require a specific store view still work against the default here.
- Create/Update Product expose friendly dropdowns for type, status, and visibility, mapped to Magento's underlying numeric/string values; custom attributes are passed through as `{attribute_code, value}` pairs.
- Update Stock needs the stock item's `item_id`, which you can obtain from Get Stock Item.

## Agent Ideas

- Use **Magento 2** "List Orders" to pull newly placed orders, then **ShipBob** "Create Order" to push each into fulfillment and **Gmail** "Send Message" to email the customer a confirmation with the expected ship date.
- When stock runs low, use **Magento 2** "Get Stock Item" to check the on-hand quantity and **Magento 2** "Update Stock" to replenish it, then log the change with **Google Sheets** "Add Row".
- Use **Magento 2** "List Customers" filtered by `created_at` to find new buyers, then **Slack** "Send Message To Channel" to alert the sales team and **Google Sheets** "Add Row" to append them to a follow-up sheet.
