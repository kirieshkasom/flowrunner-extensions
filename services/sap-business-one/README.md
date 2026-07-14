# SAP Business One FlowRunner Extension

Automate your SAP Business One ERP through the OData Service Layer. Manage business partners, items, warehouses, and price lists; run the full sales and purchasing document lifecycle (quotations, orders, deliveries, invoices, credit memos, returns); apply incoming and outgoing payments; post inventory movements and journal entries; and log CRM activities. Authentication uses a Service Layer session login (Base URL, Company DB, Username, Password) with the connection cookie reused and refreshed automatically. Includes a generic OData query passthrough and polling triggers for new records.

## Ideal Use Cases

- Syncing customers, vendors, and leads between SAP Business One and your CRM or storefront
- Raising sales quotations, orders, deliveries, and A/R invoices from web forms or other apps
- Driving the purchasing cycle: purchase quotations, orders, goods receipt POs, and A/P invoices
- Applying customer and vendor payments against open invoices and reconciling balances
- Keeping item, warehouse, and price-list master data in sync with other systems
- Posting journal entries and inventory movements (stock transfers, goods issue/receipt)
- Logging CRM activities (calls, meetings, tasks, notes) against business partners
- Running ad-hoc OData queries against any Service Layer entity when no dedicated action fits
- Kicking off workflows the moment a new sales order or business partner is created

## List of Actions

- Cancel A/R Credit Memo
- Cancel A/R Invoice
- Cancel Incoming Payment
- Cancel Order
- Cancel Outgoing Payment
- Cancel Purchase Order
- Close Delivery Note
- Close Order
- Close Purchase Order
- Close Purchase Quotation
- Close Quotation
- Create A/P Credit Memo
- Create A/P Invoice
- Create A/R Credit Memo
- Create A/R Invoice
- Create Activity
- Create Business Partner
- Create Contact
- Create Delivery Note
- Create Goods Issue
- Create Goods Receipt
- Create Goods Receipt PO
- Create Incoming Payment
- Create Item
- Create Journal Entry
- Create Order
- Create Outgoing Payment
- Create Purchase Order
- Create Purchase Quotation
- Create Quotation
- Create Return
- Create Stock Transfer
- Create Warehouse
- Delete Activity
- Delete Business Partner
- Delete Item
- Get A/P Credit Memo
- Get A/P Invoice
- Get A/R Credit Memo
- Get A/R Invoice
- Get Account
- Get Activity
- Get Business Partner
- Get Contacts
- Get Delivery Note
- Get Goods Issue
- Get Goods Receipt
- Get Goods Receipt PO
- Get Incoming Payment
- Get Item
- Get Journal Entry
- Get Order
- Get Outgoing Payment
- Get Price List
- Get Purchase Order
- Get Purchase Quotation
- Get Quotation
- Get Return
- Get Stock Transfer
- Get Warehouse
- List A/P Credit Memos
- List A/P Invoices
- List A/R Credit Memos
- List A/R Invoices
- List Accounts
- List Activities
- List Business Partners
- List Contacts
- List Delivery Notes
- List Goods Issues
- List Goods Receipt POs
- List Goods Receipts
- List Incoming Payments
- List Items
- List Journal Entries
- List Orders
- List Outgoing Payments
- List Price Lists
- List Purchase Orders
- List Purchase Quotations
- List Quotations
- List Returns
- List Stock Transfers
- List Warehouses
- Query Entities
- Update A/P Credit Memo
- Update A/P Invoice
- Update A/R Credit Memo
- Update A/R Invoice
- Update Activity
- Update Business Partner
- Update Contact
- Update Delivery Note
- Update Goods Receipt PO
- Update Item
- Update Journal Entry
- Update Order
- Update Price List
- Update Purchase Order
- Update Purchase Quotation
- Update Quotation
- Update Return
- Update Stock Transfer
- Update Warehouse

## List of Triggers

- On New Business Partner
- On New Sales Order

## Agent Ideas

- When the SAP Business One **"On New Sales Order"** trigger fires, use Gmail **"Send Message"** to notify the fulfilment team and add the order to Google Sheets **"Add Row"** for reporting.
- Use Google Sheets **"Get Rows"** to read a list of new customers, then call SAP Business One **"Create Business Partner"** and **"Create Quotation"** to seed them into the ERP.
- When the SAP Business One **"On New Business Partner"** trigger fires, call HubSpot **"Create Contact"** to mirror the account into your CRM and post Slack **"Send Message To Channel"** to alert the sales team.
