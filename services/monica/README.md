# Monica FlowRunner Extension

Integrates [Monica](https://www.monicahq.com/) — the open-source personal relationship management (CRM) app — with FlowRunner. Manage the people you care about: contacts, notes, activities, tasks, reminders, calls, tags, and journal entries. Works with the hosted app at app.monicahq.com or any self-hosted instance, authenticated with a Bearer API token.

## Ideal Use Cases

- Sync new leads or people from other tools into Monica as contacts, then log the interactions you have with them.
- Automatically record calls, activities, and notes against a contact after a meeting or conversation.
- Create and manage follow-up tasks and recurring reminders so you never lose touch with important people.
- Tag and organize contacts, and keep a personal journal of entries not tied to any single person.

## List of Actions

### Contacts
- Create Contact
- Delete Contact
- Get Contact
- List Contacts
- Search Contacts
- Update Contact

### Notes
- Create Note
- Delete Note
- Get Note
- List Notes
- Update Note

### Activities
- Create Activity
- Delete Activity
- List Activities
- Update Activity

### Tasks
- Create Task
- Delete Task
- List Tasks
- Update Task

### Reminders
- Create Reminder

### Calls
- Create Call

### Tags
- Create Tag
- List Tags
- Set Contact Tags

### Journal
- Create Journal Entry
- List Journal Entries

### User
- Get Me

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

Monica uses a Bearer token (OAuth / personal access token). In Monica, go to **Settings → API** and generate an access token. Every request is sent as `Authorization: Bearer {apiToken}`.

- **Base URL** — Monica base URL. Use `https://app.monicahq.com` for the hosted app, or your self-hosted instance URL (e.g. `https://monica.example.com`). Trailing slashes are stripped and all calls are made against `{baseUrl}/api`.
- **API Token** — required. The personal access token generated under Settings → API.

## Notes

- **Create Contact** requires Monica's three boolean flags `is_birthdate_known`, `is_deceased`, and `is_deceased_date_known`. Omitting any returns a `422` validation error, so this service always sends all three (defaulting to `false`) — toggle them only when they apply. Provide `gender_id` from Monica's Gender API when known. **Update Contact** is a full replace and also always sends these flags plus `first_name`.
- **Delete Contact** permanently removes the contact along with all of its associated notes, activities, tasks, reminders, and calls. This cannot be undone.
- **Set Contact Tags** replaces the contact's entire tag set with the provided list; tags that do not yet exist are created automatically.
- Dates use `YYYY-MM-DD` format (e.g. `happened_at`, `next_expected_date`, `called_at`). List endpoints return a `{ data, links, meta }` envelope; single-record endpoints return `{ data }`.

## Agent Ideas

- After a call, use **Monica** "Create Call" to log the conversation and "Create Task" to schedule a follow-up, then use **Gmail** "Send Message" to email the contact a recap.
- When a **Google Calendar** "Create Event" meeting is booked, use **Monica** "Search Contacts" to find the attendee and "Create Activity" to record the meeting against them.
- Use **Google Sheets** "Add Row" to export contacts fetched with **Monica** "List Contacts", or in reverse import a spreadsheet of people by calling **Monica** "Create Contact" for each row.
