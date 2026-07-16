# ClickUp FlowRunner Extension

Bring ClickUp workspace, space, folder, list, and task automation to FlowRunner. Covers the ClickUp v2 API surface most automations need: reads and writes across the hierarchy, task comments, checklists, time tracking, custom fields, attachments, tags, and both webhook and polling triggers that fire when tasks are created, updated, or deleted. Uses OAuth 2.0 and cascading dropdowns so operators pick workspaces, lists, and tasks instead of copying IDs.

## Ideal Use Cases

- Automating task creation and assignment from external triggers (forms, AI agents, emails)
- Syncing tasks between ClickUp and other tools by polling for new or updated tasks
- Building AI agents that triage work, log progress comments, and track time
- Generating folders, lists, and checklists on demand from project templates
- Reading workspace, space, and list metadata for cross-tool dashboards and reports

## List of Actions

### Workspaces
- Get Workspaces

### Spaces
- Get Spaces
- Get Space

### Folders
- Get Folders
- Create Folder
- Update Folder
- Delete Folder

### Lists
- Get Lists
- Create List
- Get List
- Update List
- Delete List

### Tasks
- Get Tasks
- Get Task
- Create Task
- Update Task
- Delete Task

### Comments
- Get Task Comments
- Create Task Comment

### Checklists
- Create Checklist
- Create Checklist Item

### Time Tracking
- Get Time Entries
- Create Time Entry

### Custom Fields
- Get List Custom Fields
- Set Task Custom Field Value
- Remove Task Custom Field Value

### Attachments
- Create Task Attachment

### Tags
- Get Space Tags
- Add Task Tag
- Remove Task Tag

## List of Triggers

Realtime triggers fire the instant a task changes, delivered by native ClickUp webhooks. Polling triggers periodically check ClickUp on an interval that can be customized in the FlowRunner UI (minimum 30 seconds).

- On Task Created (webhook) — fires the instant a task is created in a monitored list.
- On Task Updated (webhook) — fires the instant a task is updated; carries ClickUp's raw change history.
- On Task Deleted (webhook) — fires the instant a task is deleted; no polling equivalent, since deleted tasks drop out of list queries.
- On New Task (polling) — fires whenever a new task is created in a monitored list.
- On Updated Task (polling) — fires whenever an existing task in a monitored list has its content or status updated.

## Agent Ideas

- Watch a triage list and, on each new task, classify it and set priority or assignee.
- When a task moves to "in progress", post a comment and start a time entry automatically.
- Nightly, read a list's tasks and generate a status report in another tool.
- On task creation, add a standard "Definition of done" checklist from a template.
- React the instant a task is created, updated, or deleted via native webhooks, without waiting on a polling interval.
- Set a custom field value (like a priority score or external ID) the moment a task is created.
- Attach a generated report or exported file to a task automatically.
- Tag tasks based on content analysis so they show up in the right saved views.
