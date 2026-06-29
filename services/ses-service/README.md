# Amazon SES FlowRunner Extension

Zero-dependency integration with Amazon Simple Email Service (SES v2) using native AWS Signature V4 signing (Node crypto). Send transactional and templated email at scale, dispatch bulk templated emails in a single batch, and manage reusable email templates with Handlebars-style variable substitution. Supports two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Sending transactional plain-text or HTML emails (confirmations, receipts, notifications) from automated flows
- Delivering personalized email using pre-built templates with per-message variable substitution
- Broadcasting a templated email to many recipients in one batch with per-recipient customization
- Creating and reusing branded email templates managed entirely from your workflows
- Selecting verified sender identities and existing templates dynamically inside the FlowRunner UI

## List of Actions

- Create Email Template
- Send Bulk Templated Email
- Send Email
- Send Templated Email

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`.
- **Access Key** / **Secret Key** — AWS credentials, required for both methods.
- **IAM Role ARN** — role to assume, required for IAM Role authentication.
- **External ID** — optional external ID for cross-account role assumption.

## Notes

- **Verified senders** — the `From Address` must be a verified SES identity (email address or domain). Use the **List Identities** dictionary to pick from verified identities.
- **Email body** — Send Email requires at least one of `Text Body` or `HTML Body`; both may be supplied to deliver a multipart message.
- **Templates** — templated operations reference a template by name (selectable via the **List Templates** dictionary). Subject and body parts support Handlebars-style `{{variable}}` substitution.
- **Template data** — supplied as plain JSON objects; the service serializes them to the format SES expects.
- **Bulk sending** — Send Bulk Templated Email applies `Default Template Data` to every entry, with optional per-entry `replacementData` overrides, and returns a per-recipient result with `messageId`, `status`, and `error`.

## Agent Ideas

- Use **Airtable** "Find Many Records" to fetch a list of contacts, then call **Amazon SES** "Send Bulk Templated Email" to deliver a personalized campaign to all of them in a single batch.
- When a **Stripe** "Get Invoice" returns a finalized invoice, use **Amazon SES** "Send Templated Email" to email the customer a branded receipt with the invoice details substituted into the template.
- Use **Amazon SES** "Create Email Template" to define a reusable welcome message, then log each send by appending recipient and status details with **Google Sheets** "Add Row" after calling "Send Templated Email".
