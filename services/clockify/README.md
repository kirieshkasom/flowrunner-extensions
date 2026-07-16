# Clockify FlowRunner Extension

FlowRunner integration for [Clockify](https://clockify.me), the time-tracking service. Track time, manage projects, tasks, clients, and tags, and generate summary reports directly from your flows.

## Ideal Use Cases

- Log completed work or start/stop running timers from automated workflows
- Keep projects, tasks, clients, and tags in sync with your other tools
- Generate summary time reports over a date range for billing or analytics
- Look up workspace members and the authenticated user's default workspace

## Authentication

This service uses an API key. In Clockify, go to **Profile Settings -> API -> Generate** and copy the key.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Sent as the `X-Api-Key` header on every request. |

Base URL: `https://api.clockify.me/api/v1`.

## Workspace scoping

Almost every Clockify resource lives inside a **workspace**, so most operations require a **Workspace ID**. Each action exposes a workspace picker backed by the **Get Workspaces Dictionary**. To discover your workspaces (and default workspace) programmatically, use **Get Current User** (`GET /user`), which returns `defaultWorkspace` and `activeWorkspace`.

Dependent pickers (projects, clients, tags) require a workspace to be selected first, since their dictionaries filter by the chosen workspace.

## List of Actions

### Time Entries

- Add Time Entry
- Start Timer
- Stop Timer
- Get Time Entry
- List Time Entries
- Update Time Entry
- Delete Time Entry

### Projects

- List Projects
- Get Project
- Create Project
- Update Project
- Delete Project

### Tasks

- List Tasks
- Create Task
- Update Task
- Delete Task

### Clients

- List Clients
- Create Client
- Update Client
- Delete Client

### Tags

- List Tags
- Create Tag

### Users

- Get Current User
- List Workspace Users

### Reports

- Generate Summary Report

## List of Triggers

This service does not define any triggers.

## Timers vs. logged entries

- **Add Time Entry** logs an entry with a `start` and (optionally) an `end`. Provide both to record completed work.
- **Start Timer** creates an entry with `start = now` and no `end`, leaving it running. Clockify automatically stops any timer already running for the user.
- **Stop Timer** sets the running entry's `end` to the current time via `PATCH /workspaces/{workspaceId}/user/{userId}/time-entries`. It fails if no timer is running.

Time-entry create/list/stop operations are scoped to the authenticated user; the service resolves the user ID automatically from `GET /user`.

## Reports host

The **Generate Summary Report** operation targets Clockify's separate reports host, `https://reports.api.clockify.me/v1`, not the main API host. It groups results by the ordered dimensions you select (Project, Client, Task, Tag, User, Date) and returns total and billable time plus grouped breakdowns over the given date range.

## Notes

- Projects and clients must be **archived before they can be deleted**.
- Durations and estimates use ISO-8601 duration format (e.g. `PT4H30M`).
- Project colors are chosen from Clockify's fixed palette by friendly name and mapped to hex codes.

## Agent Ideas

- Use **Clockify** "Generate Summary Report" to pull last week's tracked time, then **Google Sheets** "Add Row" to append the totals into a weekly timesheet spreadsheet.
- When an **Asana** "Create Task" fires for a new project deliverable, call **Clockify** "Create Task" to mirror it under the matching Clockify project for time tracking.
- After **Clockify** "Stop Timer" closes out a session, use **Slack** "Send Message To Channel" to post a summary of the logged entry to a team channel.
