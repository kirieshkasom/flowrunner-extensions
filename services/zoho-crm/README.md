# Zoho CRM FlowRunner Extension

Full-featured Zoho CRM integration for managing records, notes, tags, related records, and lead conversion across all standard and custom modules. Connects via OAuth2 and supports dynamic module schemas, search with criteria expressions, and upsert deduplication.

## Configuration

- **Client ID** / **Client Secret** — from the Zoho API Console (api-console.zoho.com)
- **Region** — your Zoho data center: com (US), eu, in, com.au, jp, ca, sa

## Ideal Use Cases

- Automating lead capture, conversion, and contact management across CRM modules
- Syncing customer data between Zoho CRM and external systems with upsert deduplication
- Building sales pipeline workflows with automated record creation and updates
- Adding follow-up notes to leads, contacts, and deals based on workflow events
- Tagging and categorizing records for segmentation and reporting
- Navigating record relationships to enrich data across linked modules

## List of Actions

### Records

- Create or Update Record
- Create Record
- Delete Record
- Get Records
- Get Single Record
- Search Records
- Update Record

### Notes

- Create Note
- Delete Note
- Get Note
- Update Note

### Related Records

- Get Related Records
- Unlink Related Records
- Update Related Record

### Lead Conversion

- Convert Lead

### Tags

- Add Tags to Records
- Create Tag
- Get Tags
- Remove Tags from Records

## Agent Ideas

- Use **Gmail** "On New Email" trigger to capture inbound leads, then call **Zoho CRM** "Create or Update Record" on the Leads module to create or update the lead without duplicates.
- When **Zoho CRM** "Convert Lead" completes, use **Slack** "Send Message To Channel" to notify the sales team with the new contact, account, and deal details.
- Use **Zoho CRM** "Search Records" to fetch recently closed deals, then call **Google Sheets** "Add Row" to append each deal to a monthly revenue tracking spreadsheet.
