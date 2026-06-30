# Squarespace FlowRunner Extension

Integrate Squarespace Commerce with your FlowRunner workflows using a single API key. Manage products, orders, and inventory, fulfill orders with shipment tracking, and react to new and fulfilled orders through polling triggers.

## Ideal Use Cases

- Syncing your Squarespace catalog with external systems by listing, creating, and updating products
- Automating order fulfillment and shipment tracking as new orders arrive
- Monitoring stock levels and adjusting quantities across product variants
- Notifying customers or internal teams when orders are placed or fulfilled
- Building sales and inventory reports from order and inventory data

## List of Actions

### Products

- List Products
- Get Product
- Create Product
- Update Product
- Delete Product

### Orders

- List Orders
- Get Order
- Fulfill Order

### Inventory

- List Inventory
- Get Inventory Item
- Adjust Stock

## List of Triggers

- On New Order
- On Order Fulfilled

## Configuration

| Setting | Description |
|---------|-------------|
| API Key | Your Squarespace API key from Settings > Advanced > Developer API Keys |

## Agent Ideas

- When a **Squarespace** "On New Order" trigger fires, use **ShipBob** "Create Order" to push the line items to your 3PL for fulfillment
- When a **Squarespace** "On Order Fulfilled" trigger fires, use **Gmail** "Send Message" to email the customer their carrier and tracking details
- Use **Squarespace** "List Orders" to pull the day's sales, then **Google Sheets** "Add Row" to append each order to a revenue tracking sheet
