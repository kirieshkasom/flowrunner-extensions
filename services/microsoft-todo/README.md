# Microsoft To Do FlowRunner Extension

FlowRunner integration for [Microsoft To Do](https://www.microsoft.com/en-us/microsoft-365/microsoft-to-do-list-app)
built on the [Microsoft Graph To Do API](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview) (v1.0).
It lets flows manage task lists, create and update tasks with due dates, reminders, importance, categories, and
recurrence, complete or reopen tasks, and work with checklist items (subtasks) — all on behalf of the connected
user (delegated permissions).

## Ideal Use Cases

- Create tasks automatically from incoming emails, form submissions, CRM events, or support tickets
- Sync tasks between Microsoft To Do and other task/project systems (Asana, ClickUp, Google Tasks)
- Build daily digests of due or overdue tasks and post them to chat or email
- Mark tasks completed from external events (e.g. a deployment finishing, a ticket closing)
- Provision per-project task lists on demand and populate them with templated tasks and checklist steps
- Add checklist steps to an existing task as a workflow progresses

## List of Actions

### Task Lists

- Create Task List
- List Task Lists
- Update Task List
- Delete Task List

### Tasks

- Create Task
- Get Task
- List Tasks
- Update Task
- Complete Task
- Reopen Task
- Delete Task

### Checklist Items

- Add Checklist Item
- List Checklist Items
- Check Or Uncheck Checklist Item
- Delete Checklist Item

Dynamic dropdowns are provided for task lists and for tasks (dependent on the selected task list, labeled by
title with the task status as a note).

## List of Triggers

This service does not define any triggers. Microsoft Graph change notifications for To Do resources require a
publicly reachable notification URL that answers Graph's synchronous `validationToken` handshake at subscription
time, plus periodic subscription renewal. This is planned as future work.

## Authentication

The service uses OAuth2 (authorization code flow) against the Microsoft identity platform
(`login.microsoftonline.com/common`), so both personal Microsoft accounts and work/school accounts can connect
(subject to your app registration's supported account types).

### Azure App Registration Setup

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) (or Azure Portal → Microsoft
   Entra ID).
2. Go to **App registrations** → **New registration**.
3. Give the app a name (e.g. `FlowRunner To Do Integration`).
4. Under **Supported account types**, choose **Accounts in any organizational directory and personal Microsoft
   accounts** (required for the `/common` endpoint used by this service).
5. Under **Redirect URI**, select platform **Web** and enter the OAuth callback URL provided by FlowRunner
   when configuring this integration.
6. Register the app and copy the **Application (client) ID** — this is the `Client ID` config item.
7. Go to **Certificates & secrets** → **New client secret**, create a secret, and copy its **Value** — this
   is the `Client Secret` config item.
8. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** and add:
   - `offline_access`
   - `User.Read`
   - `Tasks.ReadWrite`

## Configuration

| Config Item   | Required | Description                                                     |
| ------------- | -------- | --------------------------------------------------------------- |
| Client ID     | Yes      | Application (client) ID of the Microsoft Entra app registration |
| Client Secret | Yes      | Client secret value of the Microsoft Entra app registration     |

## Notes and Limitations

- All operations run with delegated permissions and act on the connected user's own To Do data (`/me/todo`).
- Due dates and reminders are sent as Microsoft Graph `dateTimeTimeZone` objects. Provide a date
  (`YYYY-MM-DD`) or date-time (`YYYY-MM-DDTHH:mm:ss`) plus an optional time zone (defaults to `UTC`).
- Well-known lists (such as the default **Tasks** list) cannot be renamed or deleted.
- Completing a recurring task automatically schedules its next occurrence; use Reopen Task to revert a
  completed task to not started.
- List Tasks supports `$top`/`$skip` paging and status filtering; for cursor-based paging, pass the returned
  `@odata.nextLink` via the `Next Page Link` parameter.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires with an actionable request, use **Microsoft To Do** "Create Task" with a due date and high importance so nothing slips through the inbox.
- Use **Google Sheets** "On New Row" to detect a new project entry, then call **Microsoft To Do** "Create Task List" and "Create Task" to scaffold the project's task board, adding "Add Checklist Item" steps for each subtask.
- On a schedule, use **Microsoft To Do** "List Tasks" with the Not Completed filter and **Slack** "Send Message To Channel" to post a daily digest of outstanding work.
