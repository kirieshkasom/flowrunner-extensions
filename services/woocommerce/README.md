# WooCommerce FlowRunner Extension

Connect a self-hosted WooCommerce store to FlowRunner and automate your storefront over the WooCommerce REST API (`/wp-json/wc/v3`). Manage products, variations, categories, global attributes and their terms, orders, notes, refunds, customers, and coupons - bulk-sync products, orders, and customers in a single request, and react in real time to new and changed orders, products, and customers. Auth uses a per-store Consumer Key/Secret over HTTPS, with an optional query-string fallback for hosts that strip the Authorization header.

## Ideal Use Cases
- Sync products, prices, and stock between WooCommerce and another system (ERP, PIM, spreadsheet).
- Automate order fulfillment: advance status, add notes, and issue refunds without leaving your flow.
- Trigger workflows the moment an order is placed or updated - send confirmations, notify a warehouse, post to chat.
- Onboard new customers to a CRM or mailing list automatically when they register or update their profile.
- Run promotions by creating and adjusting discount coupons programmatically.
- Define reusable global attributes (e.g. Color, Size) and their terms, then build variable products from them.
- Bulk-import or reconcile large catalogs, order sets, or customer lists in one call with the batch actions.
- Let an AI agent answer "what did this customer order?" using dictionary-backed pickers.

## List of Actions
- Create Product / Get Product / List Products / Update Product / Delete Product
- Create Product Variation / Get Product Variation / List Product Variations / Update Product Variation / Delete Product Variation
- Create Product Category / Get Product Category / List Product Categories / Update Product Category / Delete Product Category
- Create Product Attribute / Get Product Attribute / List Product Attributes / Update Product Attribute / Delete Product Attribute
- Create Attribute Term / Get Attribute Term / List Attribute Terms / Update Attribute Term / Delete Attribute Term
- Create Order / Get Order / List Orders / Update Order / Delete Order
- Create Order Note / Get Order Note / List Order Notes / Delete Order Note
- Create Order Refund / Get Order Refund / List Order Refunds / Delete Order Refund
- Create Customer / Get Customer / List Customers / Update Customer / Delete Customer
- Create Coupon / Get Coupon / List Coupons / Update Coupon / Delete Coupon
- Batch Products / Batch Orders / Batch Customers

## List of Triggers
- On Order Created
- On Order Updated
- On Product Created
- On Product Updated
- On Customer Created
- On Customer Updated

## Agent Ideas

- When a **WooCommerce** "On Order Created" trigger fires, use **ShipBob** "Create Order" to push the sale into fulfillment, then **Gmail** "Send Message" to email the customer an order confirmation with the expected ship date.
- When a **WooCommerce** "On Customer Created" trigger fires, use **Brevo** "Create Contact" to add the new buyer to your CRM and mailing list automatically.
- When a **WooCommerce** "On Order Updated" trigger reports a cancelled order, chain **WooCommerce** "Create Order Refund" to return the funds and **Slack** "Send Message To Channel" to alert the finance team with the order ID and amount.
