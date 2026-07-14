# Toggl Track FlowRunner Extension

Integrates [Toggl Track](https://track.toggl.com) time tracking with FlowRunner. Manage time entries, timers, projects, clients, tags, tasks, and workspace/user data through the Toggl Track API v9.

## Ideal Use Cases

- Automatically start and stop timers when work begins or ends in another tool
- Log completed time entries from external systems into the right project and client
- Keep Toggl projects, clients, and tags in sync with your CRM or task manager
- Pull time entries on a schedule for reporting, invoicing, or timesheet exports
- Create tasks and projects programmatically when new work is scoped

## Authentication

This service uses your Toggl Track **API token** with HTTP Basic authentication.

- **Where to find it:** In Toggl Track, open **Profile Settings** and scroll to the bottom to find your **API Token**.
- **How it is sent:** The token is used as the HTTP Basic username with the literal password `api_token`. The service builds `Authorization: Basic base64("{apiToken}:api_token")` on every request.

### Configuration

| Item        | Required | Description                                                |
| ----------- | -------- | ---------------------------------------------------------- |
| `API Token` | Yes      | Your Toggl Track API token (Profile Settings → API Token). |

Base URL: `https://api.track.toggl.com/api/v9`

## Workspaces

Most operations are workspace-scoped and expose a **Workspace** parameter backed by the Get Workspaces dictionary. Leave it blank to resolve your account's `default_workspace_id` from `GET /me`.

## Running Entries (Timers)

Toggl represents a **running** (unfinished) time entry with a **`duration` of `-1`** and a `start` set to the moment it began. There is no separate "running" flag.

- **Start Timer** applies this convention for you: it sets `start` to the current time and `duration` to `-1`.
- **Create Time Entry** lets you set `duration` yourself — a positive number of seconds for a completed entry, or `-1` to create a running entry.
- **Stop Timer** closes a running entry; Toggl sets `stop` to now and computes the final `duration` from `start`.
- **Get Current Running Entry** returns the entry currently running across your workspaces, or `null` when nothing is running.

All entries created by this service are tagged with `created_with: "FlowRunner"`.

## List of Actions

### Time Entries

- Create Time Entry
- Start Timer
- Stop Timer
- Get Current Running Entry
- Get Time Entry
- List Time Entries
- Update Time Entry
- Delete Time Entry

### Projects

- Create Project
- Get Project
- List Projects
- Update Project
- Delete Project

### Clients

- Create Client
- List Clients
- Update Client
- Delete Client

### Tags

- Create Tag
- List Tags
- Update Tag
- Delete Tag

### Tasks (paid workspace plans)

- Create Task
- List Tasks
- Update Task
- Delete Task

### Workspace & User

- Get Me
- Get Workspace
- List Workspace Users

## List of Triggers

This service does not define any triggers.

## Notes

Toggl Track frequently returns **plain-text** error bodies (for example, `time entry not found` or permission messages). This service surfaces that text directly in the thrown error, falling back to structured JSON messages when Toggl returns them.

## Agent Ideas

- When a **ClickUp** "On Task Created" trigger fires, use **Toggl Track** "Start Timer" to begin tracking work against the matching project as soon as the task is assigned
- Use **Toggl Track** "List Time Entries" to pull a period's tracked hours, then call **QuickBooks Online** "Create Invoice" to bill each client for their logged time
- On a schedule, use **Toggl Track** "List Time Entries" to export tracked work and **Google Sheets** "Add Row" to append each entry into a timesheet spreadsheet
