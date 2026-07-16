# DHL FlowRunner Extension

Track shipments across all DHL business units and find DHL locations (service points, post offices, parcel lockers, and more) directly from FlowRunner. This service wraps DHL's [Shipment Tracking - Unified](https://developer.dhl.com/api-reference/shipment-tracking-unified) and [Location Finder](https://developer.dhl.com/api-reference/location-finder) APIs, authenticating with a single API key sent as the `DHL-API-Key` header.

## Ideal Use Cases

- Look up the live status and delivery estimate for a DHL tracking number and notify customers automatically
- Build a chronological delivery event timeline for support agents or order dashboards
- Help customers find the closest DHL drop-off or pickup point by address or geo-coordinate
- Enrich order records with the full details of a specific DHL location

## List of Actions

### Tracking

- Track Shipment

### Location Finder

- Find Locations by Address
- Find Locations by Geo
- Get Location by ID

## List of Triggers

This service does not define any triggers.

## Authentication

This service authenticates with a single API key, sent on every request as the `DHL-API-Key` header. The base host is `https://api-eu.dhl.com`.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key | Yes | Your DHL Developer Portal API key. |

### Getting an API key

1. Sign in to the [DHL Developer Portal](https://developer.dhl.com/).
2. Create (or open) an app.
3. Copy the app's **API Key**.

> **Product subscription note.** DHL's Shipment Tracking - Unified and Location Finder are separate products that happen to share the same `api-eu.dhl.com` host and the `DHL-API-Key` authentication scheme. A single API key only works for the products your app is subscribed to. To use every operation in this service, subscribe your app to **both** the "Shipment Tracking - Unified" and "Location Finder" products in the Developer Portal. If a key is missing a subscription, DHL returns an authorization error for that product's operations.

## Notes

- All operations are read-only `GET` requests.
- The `service`, `providerType`, and `locationType` parameters present friendly labels in the UI and are mapped to DHL's API values internally.
- DHL returns errors in RFC 7807 problem-detail format (`status`, `title`, `detail`); this service surfaces the `title` and `detail` along with the HTTP status in the thrown error message. A tracking number with no available data returns a `404`.

## Agent Ideas

- After **EasyPost** "Create and Buy Shipment" (or **Shippo** "Create Transaction (Buy Label)") returns a DHL tracking number, poll **DHL** "Track Shipment" to monitor delivery progress and status events.
- When **DHL** "Track Shipment" reports a delivery or exception status, use **Slack** "Send Message To Channel" or **Gmail** "Send Message" to alert the team or customer with the latest event details.
- Take a customer's address from an order, call **DHL** "Find Locations by Address" to suggest the nearest drop-off point, then **Get Location by ID** to include full opening hours in a **Gmail** "Send Message" confirmation.
