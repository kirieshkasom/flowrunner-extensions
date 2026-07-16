# Google Tasks FlowRunner Extension

FlowRunner integration for the [Google Tasks API](https://developers.google.com/workspace/tasks) (v1). Manage the connected user's task lists and tasks: create and organize tasks, mark them complete, reopen them, move them between lists, and clear completed items.

## Ideal Use Cases

- Auto-create tasks from incoming emails, form submissions, or calendar events
- Sync tasks between Google Tasks and other project management or spreadsheet tools
- Mark tasks complete (or reopen them) as part of a larger automated workflow
- Organize tasks by moving them between lists or repositioning them under parents
- Periodically clear completed tasks to keep active lists tidy

## List of Actions

### Task Lists

- Create Task List
- Delete Task List
- List Task Lists
- Update Task List

### Tasks

- Clear Completed Tasks
- Complete Task
- Create Task
- Delete Task
- Get Task
- List Tasks
- Move Task
- Reopen Task
- Update Task

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 (Google). The integration requests the following scopes:

- `https://www.googleapis.com/auth/tasks` — full read/write access to the user's tasks and task lists
- `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile` — used to label the connection with the user's name and avatar

### Configuration

| Config item | Description |
| --- | --- |
| Client Id | OAuth 2.0 Client ID from the Google Cloud Console |
| Client Secret | OAuth 2.0 Client Secret from the Google Cloud Console |

Setup in the [Google Cloud Console](https://console.cloud.google.com/):

1. Create (or select) a project and enable the **Google Tasks API**.
2. Configure the OAuth consent screen and add the scopes above.
3. Create an **OAuth client ID** (Web application) and register FlowRunner's redirect URI.
4. Copy the Client ID and Client Secret into the service configuration.

A **Task Lists** dictionary powers all task list selectors.

## Notes and API quirks

- **Due dates are date-only.** The Google Tasks API stores only the date portion of a task's due date; any time-of-day information is discarded when writing and is never returned when reading.
- **Cleared vs. deleted.** Clear Completed Tasks does not delete tasks — it marks them *hidden*. Hidden tasks can still be retrieved with List Tasks when *Show Hidden* is enabled. Tasks completed in Google's own clients are also hidden after clearing, so *Show Completed* alone may not surface them.
- **Pagination.** List Tasks returns up to 100 tasks per page (API default 20); List Task Lists returns up to 1000 lists per page. Use the returned `nextPageToken` as the page token for the next call.
- The user's default task list ("My Tasks") cannot be deleted.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires, use Google Tasks "Create Task" to capture the message as an actionable to-do with the sender and subject in the notes.
- When a **Google Calendar** "On Event Ended" trigger fires, use Google Tasks "Create Task" to add follow-up items, then "Complete Task" once each is handled.
- Use **Google Sheets** "Get Rows" to read a backlog spreadsheet, then call Google Tasks "Create Task" for each row to populate a task list.
