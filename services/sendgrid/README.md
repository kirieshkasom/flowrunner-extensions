# SendGrid FlowRunner Extension

Send transactional and marketing email and manage contacts, lists, suppressions, and templates through the Twilio SendGrid v3 REST API. Authenticates with a single SendGrid API key (Bearer against `https://api.sendgrid.com/v3`); zero npm dependencies.

## Ideal Use Cases

- Send transactional emails (receipts, password resets, notifications) with plain-text/HTML bodies or dynamic templates, URL attachments, and scheduled delivery
- Sync CRM or spreadsheet contacts into SendGrid Marketing Campaigns lists and search them with SGQL
- Maintain deliverability by managing global unsubscribes and bounce suppressions
- Validate email addresses before sending and report on delivery/open/click statistics

## List of Actions

### Email
- Send Email
- Send Templated Email

### Contacts
- Upsert Contacts
- Search Contacts
- Get Contact By Email
- Delete Contacts

### Lists
- Create List
- Get Lists
- Delete List

### Templates
- List Dynamic Templates

### Suppressions
- List Global Unsubscribes
- Add Global Unsubscribes
- Delete Global Unsubscribe
- List Bounces
- Delete Bounces

### Statistics
- Get Email Stats

### Validation
- Validate Email

### Senders
- Get Verified Senders

## List of Triggers

This service does not define any triggers. SendGrid's Event Webhook must be configured account-side in the SendGrid dashboard (a single account-wide, signed webhook), which does not fit the FlowRunner per-app webhook lifecycle, so inbound event triggers are intentionally not included.

## Configuration

- **API Key** (`apiKey`, required): SendGrid API key (Settings > API Keys). Use a key with Full Access, or at least Mail Send, Marketing, Suppressions, Stats, and Template Engine scopes.

## Notes

- Send Email and Send Templated Email queue asynchronously; a successful call returns `{"queued":true}` rather than a delivery confirmation. At least one of Text Content or HTML Content is required for Send Email.
- Attachments are downloaded from publicly reachable URLs and Base64-encoded (max total message size 30 MB); filename/MIME type are inferred from the URL, and sending can be scheduled up to 72 hours ahead.
- Contact and delete operations are asynchronous on SendGrid's side — use the returned `job_id` to track progress; newly added contacts can take a few minutes to appear in search.
- Validate Email requires a SendGrid plan that includes Email Address Validation (Pro and above or a dedicated Email Validation plan) and may need its own Email Validation API key.

## Agent Ideas

- When **HubSpot** "Create Contact" adds a new lead, use SendGrid "Upsert Contacts" to add them to a Marketing Campaigns list, then "Send Templated Email" to deliver a welcome message.
- Read a mailing list with **Google Sheets** "Get Rows", call SendGrid "Validate Email" on each address, and "Upsert Contacts" only for the valid ones.
- After SendGrid "Get Email Stats" retrieves a campaign's performance, use **Slack** "Send Message To Channel" to post the delivered/open/click summary to your team.
