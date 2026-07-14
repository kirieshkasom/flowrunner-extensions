# Google Contacts FlowRunner Extension

FlowRunner integration for [Google Contacts](https://contacts.google.com) — create, retrieve,
update, search, and delete contacts and manage contact groups (labels) through the
[Google People API](https://developers.google.com/people/api/rest) using the connected user's
Google account (OAuth 2.0).

## Ideal Use Cases

- Automatically create contacts from form submissions, CRM records, or new customer sign-ups.
- Keep Google Contacts in sync with external systems by updating fields when source data changes.
- Search contacts by name, email, phone, or organization to enrich workflow data.
- Organize contacts by creating groups (labels) and adding or removing members programmatically.
- Clean up address books by listing and deleting outdated contacts.

## List of Actions

### Contacts

- Create Contact
- Get Contact
- List Contacts
- Update Contact
- Delete Contact
- Search Contacts

### Contact Groups

- List Contact Groups
- Create Contact Group
- Add Contacts To Group
- Remove Contacts From Group

## List of Triggers

This service does not define any triggers.

## Authentication & Setup (Google Cloud Console)

This service uses OAuth 2.0 **user authentication**. You need a Google Cloud project with the
People API enabled and an OAuth client:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. Enable the **People API** (APIs & Services > Library > "Google People API" > Enable).
3. Configure the **OAuth consent screen** (APIs & Services > OAuth consent screen) and add the scopes:
   - `https://www.googleapis.com/auth/contacts`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
4. Create an **OAuth client ID** (APIs & Services > Credentials > Create Credentials > OAuth client ID,
   type "Web application") and add the FlowRunner OAuth redirect URI shown when configuring the
   integration.
5. Copy the **Client ID** and **Client Secret** into the integration configuration in FlowRunner,
   then connect your Google account.

## Notes & Behavior

- **Contact identifiers**: contacts are addressed by their People API resource name in the format
  `people/{personId}`; groups use `contactGroups/{contactGroupId}`. Bare IDs are accepted and
  prefixed automatically.
- **Simplified results**: contact-returning actions return a flattened shape (`displayName`,
  `firstName`, `lastName`, `emails`, `phones`, `company`, `jobTitle`, `notes`, `addresses`)
  alongside `resourceName`, `etag`, and the full People API resource in `raw`.
- **Update Contact** fetches the current contact first to obtain the required `etag` and to merge
  partial name/organization changes, then updates only the provided fields
  (`updatePersonFields`). Empty fields keep their current values.
- **Search Contacts** uses prefix matching over names, nicknames, emails, phone numbers, and
  organizations, returns at most 30 results (API maximum), and automatically sends the
  empty-query warmup request Google recommends so recently changed contacts are included.
- **Contact groups**: only user-created groups can be modified; system groups such as
  `contactGroups/myContacts` and `contactGroups/starred` are read-only. Up to 500 contacts can be
  added or removed per call.

## Configuration

| Name         | Required | Description                                             |
| ------------ | -------- | ------------------------------------------------------- |
| Client Id     | Yes      | OAuth 2.0 Client ID from the Google Cloud Console.     |
| Client Secret | Yes      | OAuth 2.0 Client Secret from the Google Cloud Console. |

## Agent Ideas

- When a new lead arrives, use **Google Contacts** "Create Contact" to add them to the address book, then **Gmail** "Send Message" to send a personalized welcome email using their stored email.
- Use **Google Sheets** "Find Rows" to pull a list of customers, then call **Google Contacts** "Search Contacts" and "Update Contact" to keep names, phones, and organizations in sync with the spreadsheet.
- Use **Google Contacts** "Search Contacts" to look up an attendee's email by name, then **Google Calendar** "Create Event" to schedule a meeting and invite them.
