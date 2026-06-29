# Shopify FlowRunner Extension

Connect FlowRunner to [Shopify](https://www.shopify.com/) to manage orders, products, collections, customers, multi-location inventory, and Shopify Payments. Authenticates with OAuth2 (single-click app flow) and adds polling triggers for new orders, customers, products, and disputes.

## Ideal Use Cases

- Retrieve and filter orders, then issue partial or full refunds with restock control.
- Browse the catalog and collections, and curate collection membership.
- Create and update customers; track multi-location inventory and stock levels.
- Monitor Shopify Payments balance, payouts, and disputes; tag and react to store events.

## List of Actions

**Orders** — Get List of Orders, Get Order, Create Refund
**Products** — Get List of Products, Get Product
**Collections** — Get List of Collections, Get Collection, Add Products to Collection, Remove Products from Collection
**Customers** — Get List of Customers, Get Customer, Create Customer, Update Customer, Delete Customer
**Inventory** — Get List of Locations, Get Location, Get List of Inventory Levels, Adjust Inventory Levels, Set Inventory Quantities, Update Inventory Item
**Payouts** — Get Shop Balance, Get List of Payouts, Get List of Disputes
**Tags** — Add Tags, Remove Tags

## List of Triggers

- On New Order
- On Order Updated
- On New Customer
- On Customer Updated
- On New Product
- On New Dispute

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, use **ShipBob** "Create Order" to push the order into fulfillment, then **Gmail** "Send Message" to email the customer a confirmation.
- When a **Shopify** "On New Dispute" trigger fires, use **Slack** "Send Message To Channel" to alert the finance team with the dispute amount and reason before the evidence deadline.
- Use **Google Sheets** "Get Rows" to read a supplier restock feed, then call **Shopify** "Set Inventory Quantities" for each SKU to keep stock in sync.
