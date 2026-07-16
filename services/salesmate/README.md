# Salesmate FlowRunner Extension

FlowRunner extension for the [Salesmate](https://www.salesmate.io/) CRM. Manage contacts, companies, deals, and activities, with dictionaries for users, pipelines, and pipeline stages. Salesmate is workspace-scoped: the API is called on your own subdomain (`{linkname}.salesmate.io`) using an access token.

## Ideal Use Cases

- Sync leads captured elsewhere into Salesmate as contacts, companies, and deals.
- Keep CRM records current by updating contacts, companies, or deals from downstream systems.
- Advance deals through pipeline stages and mark them won or lost as workflows progress.
- Log follow-up tasks, calls, meetings, and emails as Salesmate activities.
- Search and page through CRM records to feed reporting or enrichment steps.

## List of Actions

### Contacts

- Create Contact
- Get Contact
- List Contacts
- Update Contact
- Delete Contact

### Companies

- Create Company
- Get Company
- List Companies
- Update Company
- Delete Company

### Deals

- Create Deal
- Get Deal
- List Deals
- Update Deal
- Delete Deal

### Activities

- Create Activity
- List Activities

Dictionaries power the owner, pipeline, and stage pickers behind these actions: Users (owner/assignee), Pipelines (deal pipeline), and Stages (depends on the selected Pipeline).

## List of Triggers

This service does not define any triggers.

## Authentication

Salesmate is a **workspace-scoped** CRM: every account has its own subdomain (`{linkname}.salesmate.io`), and the API is called on that host. This service uses two config items (both non-shared):

| Config item      | Description |
| ---------------- | ----------- |
| `Workspace Name` | Your workspace name — the subdomain from `{linkname}.salesmate.io` (e.g. `acme`). You may also paste the full host `acme.salesmate.io`. Sent as the `x-linkname` header. |
| `Access Token`   | Generated in Salesmate under **Setup → Access Tokens** (a.k.a. API Tokens). Sent as the `accessToken` header. |

Every request sends these headers:

```
accessToken: <Access Token>
x-linkname: <workspace host, e.g. acme.salesmate.io>
Content-Type: application/json
```

**Base URL:** `https://{linkname}.salesmate.io/apis/core/v4`

List/search operations use Salesmate's paged query endpoints (`POST /{object}/search`) and accept an optional free-text query, a field selection, sort field/order, and page number/rows.

## Verification Notes (read before production use)

Verified from Salesmate's public documentation and integration guides (apidocs.salesmate.io, Rollout, Pipedream):

- **Auth headers** `accessToken` + `x-linkname` and the **workspace subdomain host** pattern are confirmed. The v1/v3 APIs were deprecated (May 2023); **v4 (`/apis/core/v4`) is current.**
- **Response wrapping:** Salesmate wraps successful bodies as `{ Data, status }`, and list endpoints return `{ Data: { data: [...], totalRows } }`. The service unwraps `Data` automatically. Errors surface via `Error`/`message` in the body plus the HTTP status.

Built from the documented CRM shapes (contacts/companies/deals/activities CRUD + paged search and the users/pipelines lookups). The exact request-body field names for create/update and the precise list-endpoint body schema can vary slightly by workspace configuration and custom fields; the `Additional Fields` object parameter on each create/update op lets you pass any standard or custom field through unchanged. **Confirm field names and the search-body shape against your workspace's API tokens page before production use.** No endpoints were invented — all paths follow the documented `/apis/core/v4/{object}` structure.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires from a prospect, use **Salesmate** "Create Contact" to add them to the CRM and "Create Deal" to open a new opportunity.
- After **Salesmate** "Update Deal" marks a deal won, use **Slack** "Send Message To Channel" to notify the sales team with the deal title and value.
- Use **Google Sheets** "Get Rows" to read a list of imported leads, then call **Salesmate** "Create Company" and "Create Contact" for each row to sync them into the CRM.
