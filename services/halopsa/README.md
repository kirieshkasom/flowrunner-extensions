# HaloPSA FlowRunner Extension

FlowRunner integration for [HaloPSA](https://halopsa.com), an all-in-one MSP / IT service management
(PSA) platform. This service lets flows manage tickets, actions, clients, sites, end users, assets,
agents and invoices.

## Ideal Use Cases

- Automatically raise a HaloPSA ticket when an alert, form submission or inbound message arrives
- Log agent notes or customer-facing updates against a ticket as part of a wider workflow
- Sync clients, sites, end users and assets between HaloPSA and other systems
- Look up ticket, client or invoice details to enrich notifications and reports
- Keep external dashboards up to date with open ticket counts and invoice totals

## List of Actions

- **Tickets** — Get Tickets, Get Ticket, Create Ticket, Update Ticket, Delete Ticket
- **Actions** — Get Actions, Create Action
- **Clients** — Get Clients, Get Client, Create Client, Update Client
- **Sites** — Get Sites
- **Users** — Get Users, Get User, Create User
- **Assets** — Get Assets, Get Asset, Create Asset
- **Agents** — Get Agents
- **Invoices** — Get Invoices

Dictionaries `Get Clients Dictionary` and `Get Agents Dictionary` back the dropdown lookups for
client and agent parameters and are not standalone actions.

## List of Triggers

This service does not define any triggers.

## Authentication

HaloPSA authenticates with the **OAuth 2.0 client credentials** grant — a non-interactive,
machine-to-machine flow (there is no "connect your account" popup). You configure three values and
the service mints and caches a bearer token automatically on each run.

**1. Create a Halo API application**

1. In HaloPSA, go to **Configuration → Integrations → Halo API**.
2. Create (or open) an application and set its authentication method to **Client Credentials**.
3. Grant the application the permissions/agent it needs to act on tickets, clients, etc.
4. Copy the **Client ID** and **Client Secret**.

**2. Configure the service**

| Config item     | Description                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `Resource URL`  | Your Halo API resource URL, e.g. `https://yourcompany.halopsa.com` (strip any trailing slash).  |
| `Client ID`     | Client ID of the Halo API application configured for Client Credentials.                         |
| `Client Secret` | Client Secret of that same application.                                                          |

The service derives the API base as `{Resource URL}/api` and mints tokens from
`{Resource URL}/auth/token` (the common Halo default). It requests the `all` scope and sends the
token as a `Bearer` header on every API call. If your Halo instance uses a **separate** authorization
host, set `Resource URL` to the host that serves both `/api` and `/auth/token`.

## Notes

**Halo POST endpoints expect a JSON array.** Halo's write (POST) endpoints expect a JSON **array of
objects**, even when creating or updating a single record. This service handles that transparently —
each create/update operation takes individual parameters, builds a single object internally, wraps it
in a one-element array (`[obj]`) and sends that to Halo. You do not need to do anything special.

**Errors.** HaloPSA returns errors in several shapes. The service surfaces the most useful message it
can find (`message`, `error`, `error_description`, or the raw body) together with the HTTP status
code, prefixed with `HaloPSA API error`.

## Agent Ideas

- When a **Slack** "On Channel Message" trigger reports an issue, use HaloPSA "Create Ticket" to raise a ticket for the affected client and reply with the new ticket ID
- After HaloPSA "Get Tickets" returns the day's open tickets, use **Google Sheets** "Add Row" to append each one to a reporting spreadsheet for stakeholder review
- When HaloPSA "Create Ticket" succeeds, use **Gmail** "Send Message" to email the requesting end user a confirmation, then log the notification with HaloPSA "Create Action"
