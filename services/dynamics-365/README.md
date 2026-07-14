# Microsoft Dynamics 365 FlowRunner Extension

FlowRunner integration for Microsoft Dynamics 365 (Dataverse). Works with any Dataverse-backed
Dynamics 365 environment (Sales, Customer Service, etc.) through the Dataverse Web API
(`/api/data/v9.2`), authenticated with OAuth2 as the signed-in user. Read, create, update, and
delete records in any table, and run FetchXML queries for aggregations and complex joins.

## Ideal Use Cases

- Sync new leads, contacts, or accounts from web forms and other CRMs into Dynamics 365.
- Automate opportunity and case updates as deals or support tickets progress.
- Enrich existing records and set lookup relationships (via `@odata.bind`) from external data.
- Pull filtered record sets or run FetchXML aggregations for reporting and downstream workflows.
- Validate a connection and resolve the signed-in user with a lightweight Who Am I check.

## List of Actions

### Connection
- Who Am I

### Records
- List Records
- Get Record
- Create Record
- Update Record
- Delete Record

### Queries
- Execute FetchXML Query

All record operations target an **entity set**: pick a common one from the dropdown
(Accounts, Contacts, Leads, Opportunities, Cases (Incidents), Tasks) or supply any table's
plural entity set name in **Custom Entity Set** (backed by a live dictionary of the
environment's tables), e.g. `accounts`, `incidents`, or a custom table like `cr123_projects`.

## List of Triggers

This service does not define any triggers.

## Setup

### 1. Register an app in Microsoft Entra ID (Azure)

1. Go to the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name the app, and under **Supported account types** choose *Accounts in any organizational directory* (or single tenant if you only connect your own org).
3. Under **Redirect URI**, select **Web** and enter the redirect URI provided by FlowRunner for this integration.
4. After creation, copy the **Application (client) ID** → use as the **Client ID** config item.
5. Go to **Certificates & secrets** → **New client secret**, copy the secret **Value** → use as the **Client Secret** config item.
6. Go to **API permissions** → **Add a permission** → **Dynamics CRM** (Dataverse) → **Delegated permissions** → check **user_impersonation** → **Add permissions**. Optionally grant admin consent for your tenant.

### 2. Find your Organization URL

1. Open the [Power Platform admin center](https://admin.powerplatform.microsoft.com) → **Environments**.
2. Select your environment and copy the **Environment URL**, e.g. `https://yourorg.crm.dynamics.com` (regional variants like `.crm4.dynamics.com` are fine).
3. Enter it as the **Organization URL** config item. A trailing slash is stripped automatically.

Note: Dynamics 365 access tokens are scoped to a single environment (`{orgUrl}/user_impersonation`), so each connection targets the environment configured in Organization URL. The connecting user must be an enabled user of that environment.

## Configuration

| Item | Shared | Description |
| --- | --- | --- |
| Client ID | yes | Application (client) ID of the Entra app registration. |
| Client Secret | yes | Client secret value of the Entra app registration. |
| Organization URL | no | Environment URL, e.g. `https://yourorg.crm.dynamics.com`. |

## Usage notes

- **Entity set names are plural logical names**: `accounts`, `contacts`, `leads`, `opportunities`, `incidents` (Cases), `tasks`. Custom tables use the publisher-prefixed plural, e.g. `cr123_projects`.
- **OData filter examples**: `statecode eq 0`, `contains(name,'acme')`, `createdon gt 2026-01-01T00:00:00Z`, combined with `and` / `or`.
- **Lookups on create/update** use the `@odata.bind` convention: `{"primarycontactid@odata.bind": "/contacts(00000000-0000-0000-0000-000000000001)"}`.
- **Pagination**: when List Records returns `@odata.nextLink`, pass it into the Next Page Link parameter to fetch the next page.
- **Include Annotations** adds formatted values and lookup display names (`Prefer: odata.include-annotations="*"`).
- **Update Record** sends `If-Match: *` by default to prevent create-via-upsert; enable the Upsert toggle to create the record with the given GUID when it is missing.
- **FetchXML** uses the singular logical name in `<entity name="account">` while the operation's entity set parameter uses the plural (`accounts`).

## Agent Ideas

- After **Outlook** "Get Messages List" surfaces an inbound sales inquiry, use **Microsoft Dynamics 365** "Create Record" to add a lead (entity set `leads`), then "Update Record" to link the originating contact via `@odata.bind`.
- Use **Microsoft Dynamics 365** "List Records" or "Execute FetchXML Query" to pull open opportunities, then **Microsoft Excel** "Add Table Rows" to build a pipeline report workbook.
- When a deal closes, use **Microsoft Dynamics 365** "Update Record" to set the opportunity status and follow with **Microsoft Teams** "Send Channel Message" to notify the sales channel.
