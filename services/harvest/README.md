# Harvest FlowRunner Extension

Integrate [Harvest](https://www.getharvest.com/) time tracking, project management, and invoicing with FlowRunner. This service wraps the [Harvest API v2](https://help.getharvest.com/api-v2/) for time entries, projects, clients, tasks, invoices, and users.

## Ideal Use Cases

- Automatically log time entries and start, stop, or restart timers from external events or schedules
- Sync clients, projects, and tasks between Harvest and your CRM or project tools
- Generate, send, and reconcile invoices as part of a billing workflow
- Report on tracked hours by paginating time entries into a spreadsheet or dashboard
- Look up the current user, the users list, or company settings to drive downstream logic

## Authentication

This service uses a Personal Access Token (PAT).

1. Go to <https://id.getharvest.com/developers> and create a **Personal Access Token**.
2. Note your **Account ID** — it is shown on the same Developers page (also available in Harvest under **Settings → Developers**).

Configure the service with:

| Config item | Description |
|-------------|-------------|
| **Account ID** | Your Harvest account ID. Sent as the `Harvest-Account-Id` header. |
| **Access Token** | Your Personal Access Token. Sent as `Authorization: Bearer <token>`. |

Every request also sends a `User-Agent: FlowRunner` header, which the Harvest API requires. Requests without a User-Agent are rejected by Harvest.

Base URL: `https://api.harvestapp.com/v2`.

## Timer notes

How you start and record time depends on your account's time-tracking mode (see **Get Company** → `wants_timestamp_timers`):

- **Duration tracking** (`wants_timestamp_timers = false`): create a time entry with a decimal `hours` value. Omitting `hours` creates a **running timer** (`is_running: true`).
- **Start/end-time tracking** (`wants_timestamp_timers = true`): create a time entry with `started_time` (and optionally `ended_time`). Omitting `ended_time` creates a **running timer**.

**Start Timer** creates a running entry by omitting hours / end time. Use **Stop Timer** and **Restart Timer** (which map to `PATCH /time_entries/{id}/stop` and `/restart`) to control it. A running timer is only created when the account's tracking mode matches — call **Get Company** first if unsure.

## Pagination

List operations return the Harvest envelope: the resource array (e.g. `time_entries`, `projects`) plus `per_page`, `total_pages`, `page`, and `next_page`. Use the **Page** parameter to walk through pages; `next_page` is `null` on the final page.

## List of Actions

- **Time Entries** — Create Time Entry, Start Timer, Stop Timer, Restart Timer, Get Time Entry, List Time Entries, Update Time Entry, Delete Time Entry
- **Projects** — List Projects, Get Project, Create Project, Update Project, Delete Project
- **Clients** — List Clients, Get Client, Create Client, Update Client, Delete Client
- **Tasks** — List Tasks, Get Task, Create Task, Update Task, Delete Task, List Task Assignments
- **Invoices** — List Invoices, Get Invoice, Create Invoice, Update Invoice, Delete Invoice, Send Invoice
- **Users & Company** — Get Current User, List Users, Get Company

## List of Triggers

This service does not define any triggers.

## Agent Ideas

- Use Harvest **List Time Entries** to pull billable hours for a project, then create a client invoice in **QuickBooks Online** with "Create Invoice" (or **Xero** "Create Invoice") from those totals.
- After Harvest **Send Invoice** goes out, post a summary with **Slack** "Send Message To Channel" so the finance team is notified.
- Read new client rows from **Google Sheets** "Get Rows", then call Harvest **Create Client** followed by **Create Project** to onboard them into time tracking automatically.
