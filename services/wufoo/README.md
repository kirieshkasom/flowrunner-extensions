# Wufoo FlowRunner Extension

Integrate [Wufoo](https://www.wufoo.com/) online forms with FlowRunner. List forms and their fields, read and create form entries (submissions), work with reports, audit account users, and manage submission webhooks — all through the Wufoo REST API v3.

## Ideal Use Cases

- Sync new Wufoo form submissions into a CRM, spreadsheet, or database.
- Programmatically submit entries to a Wufoo form from another system.
- Report on submission volume and read report entries/widgets for dashboards.
- Register a webhook so downstream automations react to each new submission.
- Audit account users and their form/report/user administration permissions.

## List of Actions

### Forms
- List Forms
- Get Form
- List Form Fields

### Entries
- List Entries
- Get Entry Count
- Create Entry

### Reports
- List Reports
- Get Report
- Get Report Entries
- Get Report Widgets

### Users
- List Users

### Webhooks
- Add Webhook
- Delete Webhook

## List of Triggers

This service does not define any triggers.

## Authentication

Wufoo uses **HTTP Basic authentication**: your API key is sent as the username and any string as the password (this service uses the conventional placeholder `footastic`). No OAuth is involved.

Configure two items:

| Config | Description |
| --- | --- |
| **Subdomain** | Your Wufoo subdomain — e.g. `fishbowl` for `fishbowl.wufoo.com`. All API calls are made against `https://{subdomain}.wufoo.com/api/v3`. |
| **API Key** | Found in Wufoo under **Account → API Information → API Key**. |

## Key Concepts

### Form identifiers

Every form-scoped operation takes a **Form Identifier**. This is the form's **Hash** (a short string like `s1afea8b1vk0jf7`) returned by **List Forms**, or the form's URL slug. Use the **Get Forms Dictionary** picker to choose a form by name; its value is the Hash.

### The `Field{n}` data model

Wufoo entries are **keyed by Field IDs**, not by human-readable labels. A submission looks like:

```json
{ "EntryId": "9", "Field1": "Wufoo", "Field105": "support@wufoo.com", "DateCreated": "2015-04-20 15:50:34" }
```

Run **List Form Fields** first to map each Field ID (e.g. `Field1`, `Field105`) to its Title, Type, and choices. You need these IDs to:

- Interpret entries returned by **List Entries** / **Get Report Entries**.
- Build a filter in **List Entries** (Filter Field + Operator + Value).
- Submit values with **Create Entry** (pass a map like `{"Field1":"Jane","Field105":"jane@example.com"}`).

Date fields expect the `YYYYMMDD` format.

## Notes

Failed writes return `{"Success":0,"ErrorText":"..."}` (optionally with `FieldErrors`); these are surfaced as descriptive errors. HTTP-level failures (including `429` rate limiting) are surfaced with their status code. **Create Entry** submissions are rate-limited to 50 per user per 5-minute window.

## Agent Ideas

- After **List Entries** returns new Wufoo submissions, use **Google Sheets** "Add Row" to log each entry (mapped from its `Field{n}` values) into a tracking spreadsheet.
- When a lead form is submitted, read it with **List Entries** and call **HubSpot** "Create Contact" to push the applicant's details into your CRM.
- Use **List Form Fields** and **Get Entry Count** to build a submission-volume summary, then send it with **Gmail** "Send Message" as a daily digest email.
