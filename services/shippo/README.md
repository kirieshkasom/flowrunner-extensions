# Shippo FlowRunner Extension

Multi-carrier shipping integration for creating labels, comparing live rates across USPS, FedEx, UPS and DHL, tracking packages, handling international customs, scheduling pickups, and managing refunds and orders.

## Ideal Use Cases

- Generating shipping labels and tracking numbers from order data
- Comparing live multi-carrier rates to pick cheapest or fastest service
- Tracking shipments end-to-end with real-time status updates
- Automating international shipments with customs declarations
- Scheduling carrier pickups and producing end-of-day manifests
- Issuing refunds for unused or void labels
- Synchronizing e-commerce orders into a fulfillment workflow

## List of Actions

- Create Address
- Create Customs Declaration
- Create Customs Item
- Create Manifest
- Create Order
- Create Parcel
- Create Pickup
- Create Refund
- Create Service Group
- Create Shipment
- Create Tracker
- Create Transaction (Buy Label)
- Delete Service Group
- Get Address
- Get Carrier Account
- Get Customs Declaration
- Get Customs Item
- Get Manifest
- Get Order
- Get Parcel
- Get Pickup
- Get Rate
- Get Refund
- Get Shipment
- Get Shipment Rates
- Get Tracking Status
- Get Transaction
- Get Webhook
- List Addresses
- List Carrier Accounts
- List Customs Declarations
- List Customs Items
- List Manifests
- List Orders
- List Parcels
- List Refunds
- List Service Groups
- List Shipments
- List Transactions
- List Webhooks
- Validate Address

## List of Triggers

- On Tracking Status Updated

## Agent Ideas

- When Shippo "On Tracking Status Updated" reports DELIVERED, use Gmail "Send Message" to notify the customer with the delivery time and tracking link.
- When a Shopify "On New Order" trigger fires, chain Shippo "Create Shipment" then "Create Transaction (Buy Label)" to produce a label per order.
- When Shippo "On Tracking Status Updated" reports FAILURE or RETURNED, use Slack "Send Message To Channel" to alert the fulfillment channel.
