# Gumroad FlowRunner Extension

Connect FlowRunner to [Gumroad](https://gumroad.com), the platform for selling digital products, memberships and licenses. This integration wraps the Gumroad API v2 to manage products, track sales and subscribers, verify license keys, run discount offer codes, and register webhook resource subscriptions. Authenticates with a Gumroad access token sent as a Bearer credential.

## Ideal Use Cases

- Sync your Gumroad product catalog, prices and published state into other systems
- React to new sales by notifying your team, logging orders, or triggering fulfillment
- Enforce seat/activation limits by verifying and revoking software license keys
- Manage membership subscribers and monitor cancellations or failed payments
- Automate discount campaigns by creating and updating offer codes
- Register webhook subscriptions so external systems are notified of Gumroad events

## List of Actions

### User
- Get Current User

### Products
- Delete Product
- Enable or Disable Product
- Get Product
- List Products

### Sales
- Get Sale
- List Sales

### Subscribers
- Get Subscriber
- List Subscribers

### Licenses
- Enable or Disable License
- Verify License

### Offer Codes
- Create Offer Code
- Delete Offer Code
- Get Offer Code
- List Offer Codes
- Update Offer Code

### Variants
- List Variant Categories

### Resource Subscriptions
- Create Resource Subscription
- Delete Resource Subscription
- List Resource Subscriptions

## List of Triggers

This service does not define any triggers.

## Authentication

Authenticates with a Gumroad **access token** (config item `Access Token`), sent on every request as an `Authorization: Bearer {accessToken}` header against `https://api.gumroad.com/v2`. Create one in Gumroad under **Settings → Advanced → Applications** by creating an application and generating an access token; an OAuth access token issued to your application works the same way.

## Notes

- Gumroad responses are wrapped as `{ "success": true, "<collection>": ... }`. When `success` is `false`, this service throws with the API's `message`.
- Prices and discount amounts are expressed in the currency's smallest unit (cents).
- **List Sales** is paginated via `next_page_key`; pass it back as the **Page Key** parameter to fetch subsequent pages.

## Agent Ideas

- Use **Gumroad** "List Sales" to pull recent orders, then call **Google Sheets** "Add Row" to log each sale into a revenue tracking spreadsheet.
- After **Gumroad** "Get Sale" captures a new order, use **Gmail** "Send Message" to send the buyer a personalized thank-you or delivery email.
- When a **Gumroad** "List Subscribers" check surfaces a cancelled or failed-payment subscriber, use **Slack** "Send Message To Channel" to alert your customer-success channel.
