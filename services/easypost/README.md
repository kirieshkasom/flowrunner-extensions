# EasyPost FlowRunner Extension

Shipping API integration for automating label purchasing, package tracking, address verification, and batch shipment processing across multiple carriers (USPS, UPS, FedEx, DHL). Supports address management, parcel definitions, carrier pickups, insurance, and refunds.

## Ideal Use Cases

- Automating shipping label creation and purchase for e-commerce orders
- Tracking packages across carriers and triggering notifications on status changes
- Verifying customer addresses before fulfillment to reduce delivery failures
- Processing bulk shipments in batches with consolidated label generation
- Scheduling carrier pickups and managing shipping insurance policies
- Requesting postage refunds for cancelled or returned shipments

## List of Actions

- Add Shipments to Batch
- Buy Batch
- Buy Pickup
- Buy Shipment
- Cancel Pickup
- Convert Label Format
- Create Address
- Create Batch
- Create Insurance
- Create Parcel
- Create Pickup
- Create Refund
- Create Shipment
- Create Shipment from Saved
- Create Tracker
- Delete Tracker
- Generate Batch Label
- Get Address
- Get Batch
- Get Insurance
- Get Parcel
- Get Pickup
- Get Shipment
- Get Tracker
- List Addresses
- List Batches
- List Shipments
- List Trackers
- Refund Insurance
- Remove Shipments from Batch
- Verify Address

## List of Triggers

- On Tracking Updated

## Agent Ideas

- When an **EasyPost** "On Tracking Updated" trigger fires with a "delivered" status, use **Gmail** "Send Message" to notify the customer with the delivery confirmation and tracking details.
- Use **Google Sheets** "On New Row" trigger to detect new orders, then call **EasyPost** "Create Shipment" and "Buy Shipment" to automatically generate and purchase shipping labels for each order.
- After **EasyPost** "Buy Shipment" completes, use **Slack** "Send Message To Channel" to post the tracking code and label URL to the fulfillment team's channel.
