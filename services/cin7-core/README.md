# Cin7 Core FlowRunner Extension

Connect FlowRunner to Cin7 Core (formerly DEAR Inventory) to automate inventory, sales and
purchasing. Manage products, customers and suppliers, run the full sale and advanced-purchase
lifecycles (quote, order, fulfilment, invoice and payment), adjust and transfer stock, run stock
takes, and keep external systems in sync with realtime webhook triggers.

Authentication uses your Cin7 Core Account ID and Application Key from Integrations > API.

## Ideal Use Cases

- Sync new sales orders, invoices and shipments into ERPs, CRMs or notification flows.
- Create and update products, customers and suppliers from forms or other apps.
- Drive the order-to-cash and procure-to-pay lifecycles end to end.
- Keep storefront stock levels and catalogs current as inventory changes.
- Automate stock adjustments, transfers between warehouses, and periodic stock takes.

## List of Actions

- Products: List, Get, Create, Update Products; List Product Availability; Product Families (List, Create, Update)
- Reference data: Categories, Brands, Units, Attribute Sets, Locations, Payment Terms, Carriers (CRUD); Price Tiers, Tax Rules, Accounts (list)
- Customers: List, Get, Create, Update
- Suppliers: List, Get, Create, Update
- Sales: List, Get, Create; Set Quote, Order, Invoice; Get Fulfilments; Set Pick, Pack, Ship; Void Fulfilment/Invoice; Payments (Create, Update, Delete)
- Purchases: List, Get, Create, Void; Set Order, Stock Received, Invoice; Payments (Create, Update, Delete)
- Stock: Adjustments, Transfers, Takes (List, Get, Create, Update, Void)

## List of Triggers

- On Customer Updated
- On Product Updated
- On Purchase Order Authorised
- On Purchase Stock Received Authorised
- On Sale Created
- On Sale Full Payment Received
- On Sale Invoice Authorised
- On Sale Order Authorised
- On Sale Shipment Authorised
- On Stock Level Changed
- On Supplier Updated

> Webhook triggers require the Automation module on your Cin7 Core subscription.

## Agent Ideas

- Order-to-cash bot: on On Sale Created, enrich the order, set the quote/order, and post it to Slack for approval.
- Fulfilment assistant: watch On Sale Order Authorised, then pick, pack and ship, notifying the customer with tracking.
- Reorder agent: on On Stock Level Changed, detect low stock and raise a purchase to the preferred supplier.
- Catalog sync: mirror On Product Updated into a storefront and keep availability current.
- Cash-collection agent: on On Sale Invoice Authorised, email the invoice and chase payment until On Sale Full Payment Received.
- Procurement bot: create suppliers and purchases from intake forms, then drive the receive/invoice/pay lifecycle.
