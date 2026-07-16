# Tapfiliate FlowRunner Extension

Manage affiliate, referral and influencer tracking on [Tapfiliate](https://tapfiliate.com) directly from your flows. This service wraps the Tapfiliate REST API (v1.6) to work with affiliates, programs, conversions, commissions and customers. Authentication uses an API key sent in the `X-Api-Key` header (Tapfiliate: **Settings -> API**).

## Ideal Use Cases

- Automatically enroll new signups as affiliates and approve them into the right program.
- Record sales as conversions and generate affiliate commissions when orders are placed.
- Sync commission approval/payout status with your accounting or ops tools.
- Attribute customers to affiliates for recurring (customer-based) tracking.
- Report on affiliates, programs and conversions inside broader automation workflows.

## List of Actions

### Affiliates
- Create Affiliate
- Get Affiliate
- List Affiliates
- Update Affiliate
- Delete Affiliate
- Approve Affiliate
- Disapprove Affiliate

### Programs
- List Programs
- Get Program
- Add Affiliate to Program
- List Program Affiliates

### Conversions
- Create Conversion
- Get Conversion
- List Conversions
- Add Commission to Conversion

### Commissions
- List Commissions
- Get Commission
- Approve Commission
- Disapprove Commission

### Customers
- Create Customer
- Get Customer
- List Customers

## List of Triggers

This service does not define any triggers.

## Notes

- Approval is per program: **Approve Affiliate** / **Disapprove Affiliate** operate on a `program_id` + `affiliate_id` pair via the `/approval/` sub-resource (PUT to approve, DELETE to disapprove).
- **Approve Commission** / **Disapprove Commission** likewise act on the commission's `/approval/` sub-resource.
- **Create Conversion** attributes the sale to a program via the `program_group` parameter and requires at least one tracking identifier (click id, referral code, customer id or coupon).
- A **Get Programs Dictionary** picker backs program-id selection in other operations.

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, use **Tapfiliate** "Create Conversion" to record the sale and generate the referring affiliate's commission.
- Use **WooCommerce** "Create Order" alongside **Tapfiliate** "Create Customer" to attribute each new buyer to their affiliate for recurring commission tracking.
- After a **Tapfiliate** "Approve Commission", use **Stripe** "Create Refund" or a payout flow to reconcile the affiliate's payable balance when an order is later refunded.
