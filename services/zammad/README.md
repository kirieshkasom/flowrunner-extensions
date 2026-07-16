# Zammad FlowRunner Extension

FlowRunner service for [Zammad](https://zammad.org/), the open-source helpdesk / customer support system. Manage tickets, articles (messages), users, organizations, groups, and tags on your self-hosted or hosted Zammad instance over its REST API.

## Ideal Use Cases

- Open a support ticket from an inbound event and post the customer's message as the first article
- Triage and route tickets by updating state, priority, group, or owner, and tag them for reporting
- Sync customers and organizations between Zammad and your CRM or spreadsheets
- Search tickets, users, and organizations with Zammad's full-text query syntax for lookups and reporting

## List of Actions

### Tickets

- Create Ticket
- Delete Ticket
- Get Ticket
- List Tickets
- Search Tickets
- Update Ticket

### Articles

- Create Article
- Get Article
- List Articles By Ticket

### Users

- Create User
- Get Current User
- Get User
- List Users
- Search Users
- Update User

### Organizations

- Create Organization
- Get Organization
- List Organizations
- Search Organizations
- Update Organization

### Groups

- List Groups

### Tags

- Add Tag
- List Tags For Object
- Remove Tag

## List of Triggers

This service does not define any triggers.

## Authentication

This service talks to your own Zammad instance over its REST API (`{serverUrl}/api/v1`) using **token authentication**. Each request is sent with the header:

```
Authorization: Token token=<apiToken>
```

### Configuration

| Item        | Required | Description                                                                                         |
| ----------- | -------- | --------------------------------------------------------------------------------------------------- |
| `serverUrl` | Yes      | Your Zammad instance URL, e.g. `https://support.example.com`. Strip any trailing slash.             |
| `apiToken`  | Yes      | A Zammad access token created under **Profile → Token Access**, scoped to the permissions you need. |

To create a token: in Zammad, open your avatar → **Profile → Token Access → Create**, grant the permissions the actions require (e.g. `ticket.agent`, `admin.user`), and copy the generated token. The token is shown only once.

Use **Get Current User** (`/users/me`) as a quick connection check to confirm the server URL and token are valid.

## Ticket & Article Model

Zammad tickets carry a **state** and a **priority**, each of which can be provided either as a friendly name or as a numeric ID:

- **State** — `new`, `open`, `pending reminder`, `pending close`, `closed` (also `merged`, `removed`), or a `state_id`.
- **Priority** — `1 low`, `2 normal`, `3 high`, or a `priority_id`.

The **group** (owning team) accepts a group name (e.g. `Users`) or a numeric group ID, and the **customer** (requester) accepts an email address (Zammad auto-creates the customer if the email is unknown) or a numeric user ID.

Every ticket has one or more **articles** — the messages in the conversation. Creating a ticket also creates its first article from the `body` you provide. Article `type` is one of `note`, `email`, `phone`, or `web`, and articles can be marked `internal` to keep them visible to agents only.

## Notes

Dynamic pickers back several parameters: **Get Groups Dictionary** (owning group), **Get Users Dictionary** (customer or owner, full-text search), and **Get States Dictionary** (ticket states configured in the instance).

Zammad returns errors as `{ "error": "...", "error_human": "..." }`. This service surfaces the human-readable message where available, e.g. `Zammad API error: <error_human>`.

## Agent Ideas

- When a **PagerDuty** "Create Incident" fires for a customer-facing outage, use **Zammad** "Search Tickets" to find affected open tickets and "Create Article" to post a status update to each customer.
- Take a new lead from **Intercom** "Search Contacts", then call **Zammad** "Create Organization" and "Create User" to onboard the customer into your helpdesk and "Create Ticket" to open their first support request.
- When a high-priority **Zammad** ticket is created (via "Create Ticket" or found with "Search Tickets"), use **Slack** "Send Message To Channel" to alert the support team with the ticket title and customer details.
