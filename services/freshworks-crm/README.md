# Freshworks CRM FlowRunner Extension

FlowRunner service for [Freshworks CRM](https://www.freshworks.com/crm/) (formerly Freshsales). Manage contacts, sales accounts, deals, and activities (tasks, appointments, notes) directly from your flows. Requests are authenticated with a Freshsales API key.

## Ideal Use Cases

- Sync inbound leads and form submissions into Freshworks CRM as new contacts and accounts
- Automatically create and advance deals as opportunities move through your sales process
- Log tasks, appointments, and notes against contacts, deals, or accounts to keep the pipeline current
- Look up contacts, deals, and accounts by name or email with free-text search during automations
- Keep owners and account associations up to date as records change in connected systems

## List of Actions

### Contacts
- Create Contact, Get Contact, Update Contact, Delete Contact
- Upsert Contact (create or update by unique field, email by default)
- List Contacts (from a view/filter; pick one with the Contact Views dictionary)
- Search CRM (free-text search across Contacts, Deals, Accounts, and Leads)

### Accounts
- Create Account, Get Account, Update Account, Delete Account
- List Accounts (from a view/filter by view ID)

### Deals
- Create Deal, Get Deal, Update Deal, Delete Deal
- List Deals (from a view/filter by view ID, e.g. Open Deals or Won Deals)

### Activities
- Create Task, List Tasks
- Create Appointment
- Create Note
- List Sales Activities

## List of Triggers

This service does not define any triggers.

## Configuration

| Item    | Required | Description |
| ------- | -------- | ----------- |
| Domain  | Yes      | Your Freshsales domain. For `yourcompany.myfreshworks.com` enter `yourcompany` (or your full bundle alias); a full URL is also accepted and normalized. |
| API Key | Yes      | Your Freshsales API key, from **Profile Settings → API Settings → Your API Key**. |

Requests are authenticated with the `Authorization: Token token=<API Key>` header against
`https://{domain}.myfreshworks.com/crm/sales/api`.

## Notes

- **View-based listing.** Freshworks CRM organizes list access around views (filters) rather than a
  flat list. Listing contacts, accounts, or deals requires a view ID. Use the Contact Views
  dictionary to pick a contact view; for accounts and deals, retrieve view IDs from the Freshworks
  CRM UI or the respective filters endpoint.
- **Resource-name wrapping.** The Freshsales API nests request bodies under the singular resource
  key (`{"contact": {...}}`, `{"deal": {...}}`, `{"sales_account": {...}}`) and returns them wrapped
  the same way. This service wraps requests and unwraps responses automatically, so you work with
  plain objects.
- **Dictionaries** (Owners, Deal Stages, Accounts, Contact Views) provide searchable selectors for
  owner/assignee, deal stage, related account, and contact view parameters.

## Agent Ideas

- Use **HubSpot** "Get All Contacts" to pull a segment of leads, then call **Freshworks CRM** "Upsert Contact" for each to mirror them into Freshsales without creating duplicates.
- After a **Freshworks CRM** "Create Deal" closes a win, use **Slack** "Send Message To Channel" to announce it to your sales team channel with the deal name and amount.
- After **Freshworks CRM** "Search CRM" finds a matching contact by email, use **Gmail** "Send Message" to send a personalized follow-up, then log the outreach with "Create Note".
