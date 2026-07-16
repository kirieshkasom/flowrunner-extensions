# Linear FlowRunner Extension

FlowRunner integration for [Linear](https://linear.app), the issue tracking and project management tool for software teams. Manage issues, projects, comments, teams, users, workflow states, and labels over Linear's GraphQL API, and react in real time to Linear events via webhooks. Authenticates with a Linear personal API key.

## Ideal Use Cases

- Automatically create Linear issues from form submissions, support tickets, or monitoring alerts
- Keep external systems in sync by updating issue status, assignee, or labels as work progresses
- Post Markdown comments to issues to relay updates from other tools or notify stakeholders
- Trigger downstream automations the moment an issue, comment, project, or label changes
- Search and report on issues across the workspace for dashboards or digests

## List of Actions

### Issues
- Create Comment
- Create Issue
- Delete Issue
- Get Issue
- List Issues
- Update Issue

### Search
- Search Issues

### Projects
- Create Project
- List Projects
- Update Project

### Teams
- Get Team
- List Teams

### Users
- Get Viewer
- List Users

### Workflow States
- List Workflow States

### Labels
- List Labels

## List of Triggers

- On Linear Event

## Authentication

This service uses a **Linear personal API key**.

1. In Linear, open **Settings → Security & access → Personal API keys** (or **Settings → API → Personal API keys**).
2. Create a new key and copy it (it starts with `lin_api_`).
3. Paste it into the **API Key** configuration item when connecting the service in FlowRunner.

The key is sent to Linear's GraphQL API in the `Authorization` header **as the raw key** (no `Bearer` prefix), which is what Linear expects for personal API keys.

## Notes

- All operations call Linear's single GraphQL endpoint (`https://api.linear.app/graphql`). Linear may return HTTP 200 with a top-level `errors` array; the service inspects it and surfaces the joined messages.
- **On Linear Event** is a realtime webhook trigger. Pick a **Resource** (Issues, Comments, Projects, or Issue Labels) and optionally scope to a single **Team**; FlowRunner registers a Linear webhook and runs your flow on each create, update, and remove event. Creating webhooks requires that your workspace/plan permits it and that the API key has the necessary access.
- Priority values map friendly labels to Linear's numeric scale: No priority (0), Urgent (1), High (2), Medium (3), Low (4).
- Delete Issue archives the issue (Linear archives rather than hard-deletes); it can be restored from Linear.

## Agent Ideas

- When an **On Linear Event** trigger fires for a newly created issue, use **Slack** "Send Message To Channel" to alert the team channel with the issue title and URL.
- Use **Google Sheets** "Get Rows" to read a backlog of tasks, then call Linear "Create Issue" for each row to bulk-import work into a team.
- When an **On Linear Event** trigger reports an issue moving to a Done state, use **Gmail** "Send Message" to email the stakeholder that their request is complete.
