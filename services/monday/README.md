# Monday.com FlowRunner Extension

Work management platform integration for automating boards, items, groups, and workspaces through Monday.com's GraphQL API. Manage project tasks, update column values, post comments, and monitor boards for changes with polling triggers.

## Ideal Use Cases

- Automating task creation and status updates across project boards
- Syncing item data between Monday.com and external systems like CRMs or spreadsheets
- Monitoring boards for new items or column changes to trigger downstream workflows
- Organizing projects by programmatically creating boards, groups, and workspaces
- Posting updates and comments on items from external events or notifications
- Bulk-updating column values across items based on business logic

## List of Actions

- Archive Item
- Change Column Value
- Change Multiple Column Values
- Create Board
- Create Column
- Create Group
- Create Item
- Create Subitem
- Create Update
- Create Workspace
- Delete Board
- Delete Group
- Delete Item
- Delete Subitem
- Delete Update
- Duplicate Board
- Duplicate Group
- Get Board
- Get Item
- Move Item to Group
- Update Item Name

## List of Triggers

- On Item Column Change
- On New Item

## Agent Ideas

- When a **Monday.com** "On New Item" trigger fires, use **Slack** "Send Message To Channel" to notify the team about the new task with board and group details
- Use **Google Sheets** "On New Row" trigger to capture form submissions, then call **Monday.com** "Create Item" to add each entry as a task on the appropriate board with column values pre-filled
- When a **Monday.com** "On Item Column Change" trigger detects a status change to "Done", use **Gmail** "Send Message" to notify the client that their request has been completed
