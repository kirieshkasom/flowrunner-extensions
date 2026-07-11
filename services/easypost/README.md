# EasyPost FlowRunner Extension

Shipping API integration for automating label purchasing, package tracking, and batch shipment processing across multiple carriers (USPS, UPS, FedEx, DHL). Supports addresses, parcels, pickups, insurance, international customs declarations, refunds, and webhook management.

## Ideal Use Cases

- Automating label creation and purchase for e-commerce orders, including one-step buy
- Tracking packages and notifying customers on status changes
- Verifying addresses before fulfillment
- Preparing customs declarations for international shipments
- Processing bulk shipments in batches with consolidated labels
- Scheduling pickups, insurance, and postage refunds
- Registering webhook endpoints for account events

## List of Actions

- Add Shipments to Batch
- Buy Batch
- Buy Pickup
- Buy Shipment
- Cancel Pickup
- Convert Label Format
- Create Address
- Create and Buy Shipment
- Create Batch
- Create Customs Info
- Create Customs Item
- Create Insurance
- Create Parcel
- Create Pickup
- Create Refund
- Create Shipment
- Create Shipment from Saved
- Create Tracker
- Create Webhook
- Delete Tracker
- Delete Webhook
- Generate Batch Label
- Get Address
- Get Batch
- Get Customs Info
- Get Customs Item
- Get Insurance
- Get Parcel
- Get Pickup
- Get Shipment
- Get Tracker
- Get Webhook
- List Addresses
- List Batches
- List Shipments
- List Trackers
- List Webhooks
- Refund Insurance
- Refund Shipment
- Remove Shipments from Batch
- Update Webhook
- Verify Address

## List of Triggers

- On Tracking Updated

## Agent Ideas

- When an **EasyPost** "On Tracking Updated" trigger fires "delivered", use **Gmail** "Send Message" to notify the customer.
- Use **Google Sheets** "On New Row" to detect new orders, then call **EasyPost** "Create Shipment" and "Buy Shipment" to generate and purchase labels.
- For international orders, call **EasyPost** "Create Customs Info" first, then pass its ID into "Create and Buy Shipment".
