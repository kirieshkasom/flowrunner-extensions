# One Simple API FlowRunner Extension

FlowRunner integration for [One Simple API](https://onesimpleapi.com) — a utility toolkit that bundles common web utilities (screenshots, PDFs, QR codes, currency conversion, email validation, domain/SSL expiry, URL tools, and metadata lookups) behind a single API. Authentication is a single API token sent as the `token` query parameter, added automatically on every request.

## Ideal Use Cases

- Capture screenshots or PDF snapshots of live web pages for archiving, previews, or reports.
- Generate QR codes on the fly from URLs, text, or phone numbers.
- Convert amounts between currencies at live exchange rates inside a workflow.
- Validate email addresses (syntax, MX, disposable/free) before adding them to a list.
- Monitor domain registration and SSL certificate expiry to avoid downtime.
- Expand or shorten URLs and inspect image/video metadata before further processing.

## List of Actions

### Website

- Check Domain Expiry
- Check Website Status
- Generate PDF From URL
- Take Screenshot

### Information

- Convert Currency
- Get Currency List
- Get Image Info
- Get Video Info

### Utility

- Expand URL
- Generate QR Code
- Shorten URL
- Validate Email

## List of Triggers

This service does not define any triggers.

## Output Formats

Media-producing operations (Take Screenshot, Generate PDF From URL, Generate QR Code) accept an **Output** option:

- **JSON** (default) — returns a hosted URL to the generated asset in the JSON response.
- **Inline** — returns the raw image/PDF data.

## Notes

- The service sends requests to `https://onesimpleapi.com/api/<endpoint>?token=<token>`. Errors are surfaced as a thrown `One Simple API error (<status>): <message>`; a `success: false` payload is treated as an error.
- Some endpoint slugs vary by One Simple API plan and are worth a live smoke test before relying on them. In particular, **Shorten URL** and **Get Video Info** may not be available on all plans and will surface the provider's error if unsupported.

## Agent Ideas

- Use **One Simple API** "Take Screenshot" to capture a hosted image of a landing page, then use **Slack** "Send Message To Channel" to post the screenshot URL to a monitoring channel.
- When **Airtable** "Get Records" returns rows with a website URL, call **One Simple API** "Check Domain Expiry" for each and write renewal dates back so a team can track expiring domains and SSL certificates.
- Use **One Simple API** "Validate Email" to screen an address before **Gmail** "Send Message" delivers to it, skipping known-invalid or disposable recipients.
