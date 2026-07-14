# Easyship FlowRunner Extension

Global shipping and fulfillment integration that connects your workflows to 250+ couriers through Easyship. Compare rates, create shipments, generate labels, schedule pickups, and track parcels worldwide from a single API.

## Ideal Use Cases

- Comparing courier rates in real time at checkout to display the cheapest, fastest, or best-value option
- Automating shipment creation and label generation for ecommerce orders
- Scheduling and managing courier pickups for outbound shipments
- Generating end-of-day manifests for courier handover
- Reacting to delivery status changes as parcels move through transit
- Maintaining a centralized product catalog with customs (HS code) data for international shipping
- Looking up customs HS codes and item categories to classify products for cross-border shipments
- Tracking asynchronous batch label jobs and inspecting their per-shipment results
- Managing a library of saved sender, return, and billing addresses
- Storing reusable custom packaging dimensions for consistent rate calculations

## List of Actions

- Cancel Pickup
- Cancel Shipment
- Create Address
- Create Box
- Create Manifest
- Create Product
- Create Shipment
- Deactivate Address
- Delete Box
- Delete Product
- Generate Labels
- Get Account
- Get Batch Status
- Get Shipment
- List Addresses
- List Batch Items
- List Batches
- List Boxes
- List Couriers
- List HS Codes
- List Item Categories
- List Manifests
- List Pickup Slots
- List Pickups
- List Products
- List Shipment Documents
- List Shipments
- List Trackings
- Request Rates
- Schedule Pickup
- Update Address
- Update Box
- Update Product
- Update Shipment

## List of Triggers

- On Tracking Status Changed

## Agent Ideas

- When an Easyship **"On Tracking Status Changed"** trigger fires, use Gmail **"Send Message"** to email the customer their latest delivery status, then log the checkpoint with Google Sheets **"Add Row"**.
- Use Shopify **"List Orders"** to read new orders, then call Easyship **"Request Rates"** and **"Create Shipment"** to pick the cheapest courier and generate a label automatically.
- When an Easyship **"On Tracking Status Changed"** trigger reports a delivered parcel, post Slack **"Send Message To Channel"** to notify your fulfillment team and close out the order.
