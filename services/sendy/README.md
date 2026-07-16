# Sendy FlowRunner Extension

Integrate a self-hosted [Sendy](https://sendy.co) installation with FlowRunner. Manage list subscribers, check subscription status and counts, retrieve brands, and create or send email campaigns. Sendy is self-hosted, so there is no OAuth — authentication uses your installation URL plus an API key.

## Ideal Use Cases

- Sync new leads or customers from a form, CRM, or spreadsheet into a Sendy mailing list
- Automatically unsubscribe or delete contacts in Sendy when they opt out elsewhere
- Look up a contact's subscription status or a list's active subscriber count before taking further action
- Programmatically draft and send email campaigns to one or more lists from an automated workflow

## List of Actions

### Subscribers

- Subscribe
- Unsubscribe
- Delete Subscriber
- Get Subscription Status
- Get Active Subscriber Count

### Campaigns

- Create Campaign

### Brands

- Get Brands

## List of Triggers

This service does not define any triggers.

## Configuration

| Config Item | Required | Description |
| --- | --- | --- |
| Installation URL | Yes | Your self-hosted Sendy base URL, e.g. `https://sendy.example.com`. A trailing slash is stripped automatically. |
| API Key | Yes | Your Sendy API key, found in Sendy under **Settings → your API key**. |

Both values are stored per connection and are not shared across the marketplace.

## Notes

- **Requests**: Every call is a `POST` with an `application/x-www-form-urlencoded` body, and your `api_key` is included in the body of every request. Endpoints are PHP paths under your installation URL (for example `/subscribe`, `/unsubscribe`, and `/api/campaigns/create.php`).
- **Sendy returns PLAIN TEXT, not JSON.** Responses are short plain-text strings, and errors are returned with an HTTP 200 status as text as well. This service returns the raw response text and treats known error phrases as failures (throwing an error) so failed operations do not look successful. Do not attempt to JSON-parse the output of the subscriber/campaign operations.
  - **Success** looks like `true`, a status word such as `Subscribed`, or a message such as `Campaign created`.
  - **Errors** are plain-text strings such as `Already subscribed.`, `Invalid API key`, `Invalid email address.`, `Email does not exist.`, or `List does not exist`, surfaced as thrown errors.
  - **Get Brands** is the one exception: on success it returns a JSON string (of brand IDs and names) that this service passes through as raw text.
- **Send now vs. draft**: **Create Campaign** creates a draft by default; enable **Send Campaign** and provide list IDs to send immediately.
- Boolean flags (GDPR consent, silent, send campaign) are sent to Sendy as string values, as the API expects.
- The list ID is the encrypted list ID shown in your Sendy dashboard, not a numeric database ID.

## Agent Ideas

- When a **Typeform** submission is received, use **Sendy** "Subscribe" to add the respondent's email and name to a mailing list, then "Get Subscription Status" to confirm the opt-in.
- Use **Google Sheets** "Get Rows" to pull a list of contacts, then call **Sendy** "Subscribe" for each row to bulk-import them into a Sendy list.
- After **HubSpot** "Create Contact" adds a new lead, use **Sendy** "Subscribe" to enroll them in a nurture list and later "Get Active Subscriber Count" to track list growth.
