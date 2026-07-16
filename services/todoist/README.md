# Todoist FlowRunner Extension

Integrate [Todoist](https://todoist.com) with FlowRunner to manage tasks, projects, sections, labels, and comments. Built on the Todoist API v1 and authenticated with a personal API token.

## Ideal Use Cases

- Auto-create Todoist tasks from incoming emails, form submissions, or chat messages.
- Sync project tasks with spreadsheets or other project-management tools.
- Set natural-language due dates (e.g. "tomorrow at 5pm", "every Monday") and friendly priorities from automated flows.
- Post comments or move tasks between projects/sections as part of a workflow.
- Manage labels and shared-project collaborators programmatically.

## List of Actions

### Tasks
- Create Task
- Get Task
- List Tasks
- Update Task
- Close Task
- Reopen Task
- Delete Task
- Move Task

### Projects
- Create Project
- List Projects
- Get Project
- Update Project
- Delete Project
- Get Collaborators

### Sections
- Create Section
- List Sections
- Delete Section

### Labels
- Create Label
- List Labels
- Update Label
- Delete Label

### Comments
- Create Comment
- List Comments
- Get Comment
- Update Comment
- Delete Comment

## List of Triggers

This service does not define any triggers.

## Authentication

This service authenticates with a personal **API token** sent as a Bearer token.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Token   | Yes      | Your Todoist API token. |

To find your token, open Todoist and go to **Settings → Integrations → Developer → API token**.

## Notes

### Natural-language due dates
When creating or updating a task you can set the due date two ways:
- **Due String** – natural language such as `tomorrow at 5pm`, `next Monday`, or `every day` (recurring). This is parsed in the account's language and time zone.
- **Due Date** – a fixed calendar date in `YYYY-MM-DD` format.

If both are provided, **Due String takes precedence**.

### Priority is inverted
Todoist's underlying priority is inverted relative to how it reads in the UI. This service exposes friendly labels so you don't have to remember the mapping:

| Label       | API value   |
| ----------- | ----------- |
| P1 Urgent   | 4 (highest) |
| P2 High     | 3           |
| P3 Medium   | 2           |
| P4 Normal   | 1 (default) |

### Pagination
List operations return a `results` array plus a `next_cursor`. When `next_cursor` is non-null, pass it back in as the **Cursor** parameter to fetch the next page.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires, call **Todoist** "Create Task" with a natural-language Due String to turn the email into a follow-up task.
- Use **Google Sheets** "Get Rows" to read a project plan, then call **Todoist** "Create Task" for each row to populate a Todoist project.
- After **Todoist** "Close Task" completes a task, use **Slack** "Send Message To Channel" to notify the team that the item is done.
- When a **Google Calendar** "Create Event" schedules a meeting, call **Todoist** "Create Task" to add a prep reminder due before the event.
