# Agile CRM FlowRunner Extension

Manage Agile CRM contacts, companies, deals, tasks, notes, and tags directly from your flows.
Authentication uses **HTTP Basic** with your account email and REST API key
(`base64('{email}:{apiKey}')`); all requests target `https://{subdomain}.agilecrm.com/dev/api`.

## Ideal Use Cases

- Sync inbound leads into Agile CRM as contacts and companies, then tag and route them automatically.
- Keep sales pipelines current by creating and updating deals, tracks, and milestones from your flows.
- Automate follow-up by creating tasks and notes tied to specific contacts.
- Enrich or clean CRM records in bulk by searching, updating, and re-tagging contacts.

## List of Actions

### Contacts

- Create Contact, Get Contact, Get Contact by Email, List Contacts, Update Contact, Delete Contact,
  Search Contacts
- Add Tags to Contact, Delete Tags from Contact

### Companies

- Create Company, Get Company, List Companies, Update Company, Delete Company

### Deals

- Create Deal, Get Deal, List Deals, Update Deal, Delete Deal

### Tasks

- Create Task, List Pending Tasks, Update Task, Delete Task

### Notes

- Create Note, List Notes for Contact

## List of Triggers

This service does not define any triggers.

## Authentication

Configure three items:

| Config item       | Description                                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| **Subdomain**     | Your Agile CRM subdomain, e.g. `yourcompany` from `yourcompany.agilecrm.com`. |
| **Account Email** | The email address of your Agile CRM account.                                  |
| **REST API Key**  | Found under **Admin Settings → API & Analytics → REST API**.                  |

## Notes

**The properties-array model.** Agile CRM stores contact and company fields as an **array of property
objects** rather than a flat object. Each property looks like:

```json
{ "type": "SYSTEM", "name": "email", "value": "john@example.com", "subtype": "work" }
```

- `type` is `SYSTEM` for built-in fields (`first_name`, `last_name`, `name`, `email`, `phone`,
  `company`, `title`, `website`, `address`, `image`) or `CUSTOM` for user-defined fields.
- `subtype` disambiguates multi-value fields (e.g. `email` → `work`/`personal`, `phone` →
  `work`/`home`/`mobile`).

To make this easier to work with, the service:

- **On write** — accepts simple parameters (First Name, Last Name, Email, Phone, Company, Title,
  etc.) and converts them into the properties array for you. You can also pass a **Raw Properties**
  array for custom fields or non-default subtypes; raw entries are appended on top of the simple
  fields.
- **On read** — returns the original `properties` array and additionally attaches a flattened
  `simple` object (`{ "first_name": "John", "email": "john@example.com" }`) for convenient access.

Additional behavior:

- **Case-sensitivity** — emails, names, and milestone names must match exactly as stored in your domain.
- **Deals** — track (pipeline) and milestone selection are powered by the **Get Tracks** and
  **Get Milestones** dictionaries; `expected_value` is required by Agile CRM when creating a deal.
- **Pagination** — list operations use cursor-based pagination, returning `{ items, cursor }`; pass
  the `cursor` back into the next call. When no `cursor` is present, you have reached the last page.
- **Dates** — task due dates and deal close dates are Unix timestamps in seconds.

## Agent Ideas

- When **Typeform** "Get Form Responses" returns a new lead submission, call **Agile CRM**
  "Create Contact" and "Add Tags to Contact" to register and segment the lead automatically.
- After **Agile CRM** "Create Deal" runs, use **Gmail** "Send Message" to notify the sales owner
  with the deal name, expected value, and close date.
- Use **Agile CRM** "List Contacts" to pull records, then **Google Sheets** "Add Row" to export each
  contact into a spreadsheet for reporting.
