# Mautic FlowRunner Extension

Integrate [Mautic](https://www.mautic.org/), the open-source marketing automation platform, with FlowRunner over HTTP Basic authentication. Manage contacts, segments, campaigns, companies, emails, tags, notes, forms, and stages on your self-hosted or cloud Mautic instance.

## Ideal Use Cases

- Sync new leads from forms, CRMs, or spreadsheets into Mautic as contacts and enroll them in nurture campaigns
- Segment contacts and trigger targeted email sends to individuals or entire segments
- Keep company records and contact associations up to date across systems
- Log timeline notes and move contacts through funnel stages as they progress
- Apply and remove tags to drive Mautic automation rules

## List of Actions

### Contacts
- Create Contact, Get Contact, List Contacts, Edit Contact, Delete Contact

### Segments
- List Segments, Create Segment, Add Contact to Segment, Remove Contact from Segment

### Campaigns
- List Campaigns, Get Campaign, Add Contact to Campaign, Remove Contact from Campaign

### Companies
- Create Company, List Companies, Get Company, Edit Company, Delete Company, Add Contact to Company

### Emails
- List Emails, Send Email to Contact, Send Email to Segment

### Tags
- List Tags

### Notes
- Create Note, List Notes

### Forms & Stages
- List Forms, List Stages, Add Contact to Stage

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses **HTTP Basic authentication** against your own Mautic instance. Three config items are required:

- **Instance URL** (`baseUrl`) — the base URL of your Mautic instance, e.g. `https://mautic.example.com`. Any trailing slash is stripped; all calls target `{Instance URL}/api`.
- **Username** — a Mautic user that has API access.
- **Password** — that user's password.

### Server-side requirements

Mautic ships with its API disabled by default. Before this service can connect, an administrator must, in **Configuration → API Settings**:

1. Set **API enabled?** to *Yes*.
2. Set **Enable HTTP basic auth?** to *Yes* (this integration sends `Authorization: Basic base64(username:password)` on every request).

OAuth2 is the alternative Mautic auth method. Basic auth is the simplest, but because it must be enabled server-side it is off until you turn it on.

## Response Shapes

Mautic wraps its resources, and this service preserves that with two conventions:

- **Single resources** are wrapped under their singular name — e.g. `Get Contact` returns `{ "contact": { ... } }`, `Get Company` returns `{ "company": { ... } }`.
- **Lists** are returned by Mautic as an **object keyed by ID** (not an array), alongside a `total` count — e.g. `{ "total": 2, "contacts": { "47": {...}, "48": {...} } }`. This service **normalizes every list into a plain array** while keeping `total`, so `List Contacts` returns `{ "total": 2, "contacts": [ {...}, {...} ] }`. The same normalization applies to segments (`lists`), campaigns, companies, emails, tags, notes, forms, and stages.

Tags are applied or removed via Create/Edit Contact's Tags field (prefix a tag with `-` to remove it). Searchable dictionaries (Segments, Campaigns, Emails, Forms) back the ID parameters used across these operations. Errors are surfaced as `Mautic API error: <message>`.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires from a prospect, use Mautic "Create Contact" to add them and "Add Contact to Campaign" to enroll them in a nurture sequence.
- Use **Google Sheets** "Get Rows" to pull a lead list, then call Mautic "Create Contact" for each row and "Add Contact to Segment" to build a targeted audience.
- After Mautic "Send Email to Segment" completes, use **Slack** "Send Message To Channel" to post the sent/failed/pending counts to your marketing channel.
