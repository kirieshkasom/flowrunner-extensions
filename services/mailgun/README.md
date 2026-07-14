# Mailgun FlowRunner Extension

FlowRunner integration for [Mailgun](https://www.mailgun.com), the transactional email service by Sinch. Send plain, HTML, and templated email with FlowRunner file attachments, query the event log, validate email addresses, manage mailing lists and members, maintain per-domain suppression lists (bounces, unsubscribes, complaints), pull aggregated sending statistics, and inspect sending domains.

## Ideal Use Cases

- Send transactional or templated emails (receipts, notifications, password resets) from an automated workflow
- Validate email addresses before adding them to a mailing list or CRM
- Sync signups into a Mailgun mailing list and manage members over time
- Keep suppression lists tidy by adding/removing bounces and unsubscribes
- Poll the event log or pull statistics to monitor deliverability

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **API Key** | Yes | Your private Mailgun API key. In the Mailgun dashboard go to **Settings → API Security** and copy an existing key or create a new one. |
| **Region** | Yes | `US` (default) or `EU`. Mailgun accounts are hosted in one region: US accounts use `https://api.mailgun.net`, EU accounts use `https://api.eu.mailgun.net`. If your API calls return 401 with a valid key, you are most likely pointing at the wrong region. |

Authentication is HTTP Basic with username `api` and your API key as the password; the service handles this automatically.

## List of Actions

### Messages
- Send Email
- Send Templated Email

### Events
- Get Events

### Email Validation
- Validate Email Address

### Mailing Lists
- Create Mailing List
- List Mailing Lists
- Get Mailing List
- Delete Mailing List
- Add List Member
- List Members
- Delete List Member

### Suppressions
- List Bounces
- Delete Bounce
- List Unsubscribes
- Add Unsubscribe
- Delete Unsubscribe
- List Complaints

### Statistics
- Get Stats

### Domains
- List Domains
- Get Domain

Domain and mailing-list parameters offer pickers backed by live dictionaries.

## List of Triggers

This service does not define any triggers. Mailgun webhooks must be configured per domain in the Mailgun dashboard (Sending → Webhooks). Use **Get Events** to poll for delivery activity if needed.

## Notes

- The sandbox domain Mailgun provisions for new accounts can only send to authorized recipients; add a verified custom domain for production sending.
- Scheduled delivery (`Delivery Time`) is limited by Mailgun to a few days in the future depending on your plan.
- **Validate Email Address** requires a Mailgun plan that includes email validations.

## Agent Ideas

- When a **Calendly** "On Invitee Created" trigger fires, use Mailgun "Send Templated Email" to send the invitee a branded confirmation with meeting details.
- Use **Typeform** "Get Form Responses" to pull new signups, call Mailgun "Validate Email Address" to filter out invalid addresses, then Mailgun "Add List Member" to enroll the valid ones into a mailing list.
- After **HubSpot** "Create Contact" adds a new lead, use Mailgun "Send Email" to deliver a welcome message and Mailgun "Get Events" to confirm it was delivered.
