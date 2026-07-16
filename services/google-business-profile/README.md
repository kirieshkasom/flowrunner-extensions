# Google Business Profile FlowRunner Extension

Manage Google Business Profile accounts, business locations, and customer reviews from FlowRunner. This service wraps the Google Business Profile APIs (Account Management, Business Information, and the legacy v4 Reviews API) behind a single OAuth2 (Google) connection.

## Ideal Use Cases

- Monitor and reply to new customer reviews across all of a business's locations from a single automation
- Keep location details (hours, phone, website) in sync with an external source of truth
- Aggregate reviews and average ratings across multiple locations for reporting or alerting
- Audit an account's locations and their media assets on a schedule

## List of Actions

### Accounts

- Get Account
- List Accounts

### Locations

- Get Location
- List Locations
- Update Location

### Reviews

- Batch Get Reviews
- Delete Review Reply
- Get Review
- List Reviews
- Reply To Review

### Media

- List Location Media

## List of Triggers

This service does not define any triggers.

## Data Model

Google Business Profile is organized hierarchically:

1. **Accounts** — a personal account or an organization / location group you can manage. Identified by the full resource name `accounts/{accountId}`.
2. **Locations** — the individual business locations under an account. Identified by the full resource name `locations/{locationId}`.
3. **Reviews** — customer reviews attached to a location, addressed by `accounts/{accountId}/locations/{locationId}/reviews/{reviewId}`.

Most operations accept either the full resource name or the bare id and normalize it internally, but selecting locations always requires the parent account first. The **Get Accounts** and **Get Locations** pickers supply these values to dependent parameters.

## Authentication (OAuth2 — Google)

This service uses Google OAuth2 with offline access (refresh tokens).

- **Authorization endpoint:** `https://accounts.google.com/o/oauth2/v2/auth` (`access_type=offline`, `prompt=consent`)
- **Token endpoint:** `https://oauth2.googleapis.com/token`
- **Scope:** `https://www.googleapis.com/auth/business.manage`

### Google Cloud setup

1. Create (or select) a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the OAuth consent screen and add the `https://www.googleapis.com/auth/business.manage` scope.
3. Create an **OAuth 2.0 Client ID** (Web application) and add FlowRunner's redirect URI.
4. Enable the required APIs for your project:
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Google My Business API** (legacy v4, required for Reviews and Media)
5. Copy the **Client ID** and **Client Secret** into this service's configuration.

> **Allowlisting note:** The Google Business Profile APIs are access-restricted. Your Google Cloud project must be approved through Google's [Business Profile APIs access request form](https://support.google.com/business/contact/api_default) before calls will return data. Newly created projects have a very low (often zero) default quota until the request is granted.

## Configuration

| Name | Description |
| --- | --- |
| Client Id | OAuth 2.0 Client ID from the Google Cloud Console |
| Client Secret | OAuth 2.0 Client Secret from the Google Cloud Console |

## The `readMask` requirement (important)

Every **Business Information** read (List Locations, Get Location) **requires** a `readMask` — a comma-separated list of the location fields to return. This service always sends a sensible default when you don't supply one (`name,title,storefrontAddress,phoneNumbers` for lists; a broader set for Get Location), so calls never fail for a missing mask. Supply your own `Read Mask` to request additional fields such as `websiteUri`, `regularHours`, `categories`, or `metadata`. Similarly, **Update Location** requires an `updateMask` naming exactly the fields you are changing.

## Supported surface & deprecations

Reviews and locations are the actively supported surface of this integration. Review and media operations use the legacy Business Profile **v4** API; Batch Get Reviews accepts up to 10 locations and List Reviews returns up to 50 per page. The **Local Posts** API (`createLocalPost` and related endpoints) has been **deprecated by Google** and is intentionally **not** included in this service.

## Agent Ideas

- Use **Google Business Profile** "List Reviews" to pull recent low-star reviews, then **Slack** "Send Message To Channel" to alert the support team so they can draft a response.
- After a customer complaint is resolved, use **Google Business Profile** "Reply To Review" to post the public response and **Gmail** "Send Message" to confirm resolution with the customer.
- Use **Google Business Profile** "Batch Get Reviews" across an account's locations, then **Google Sheets** "Add Row" to log each location's average rating and review count for a weekly reputation report.
