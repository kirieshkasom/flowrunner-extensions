# Taiga FlowRunner Extension

Integrate [Taiga](https://taiga.io) — the open-source agile project management platform — with FlowRunner. Manage projects, user stories, tasks, issues, epics, and milestones (sprints) directly from your flows. Authenticates with your Taiga username and password (exchanged for a short-lived `auth_token`) and works with both the hosted app and self-hosted instances.

## Ideal Use Cases

- Automatically create user stories, tasks, or issues in Taiga from inbound tickets, form submissions, or chat messages
- Keep an external system in sync by listing and updating stories, tasks, and issues across a project's sprints
- Spin up new sprints (milestones) and epics as part of a release-planning automation
- Triage bugs by creating issues with the correct type, priority, and severity pulled from a project's configuration
- Verify a connection and resolve project/member context before running downstream automation steps

## List of Actions

### Projects
- List Projects
- Get Project
- Get Project by Slug

### User Stories
- List User Stories
- Get User Story
- Create User Story
- Update User Story
- Delete User Story

### Tasks
- List Tasks
- Get Task
- Create Task
- Update Task
- Delete Task

### Issues
- List Issues
- Get Issue
- Create Issue
- Update Issue

### Epics
- List Epics
- Create Epic

### Milestones
- List Milestones
- Create Milestone

### Members
- Get Me
- List Memberships

## List of Triggers

This service does not define any triggers.

## Authentication

Taiga authenticates with a **username/password login** that is exchanged for a short-lived `auth_token`. This service performs that exchange for you:

1. On the first API call of an invocation, it sends `POST {url}/api/v1/auth` with `{ "type": "normal", "username", "password" }`.
2. Taiga returns an `auth_token`, which the service caches and sends as `Authorization: Bearer {auth_token}` on every subsequent request.
3. If a request returns `401`, the token is re-minted once and the request is retried.

You never handle the token yourself — just supply your credentials as configuration. This is a normal login, not an interactive OAuth connection.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **API URL** | No | Base Taiga API URL. Defaults to `https://api.taiga.io` for the hosted app. For a self-hosted instance, use your server URL (append `/api` if your deployment serves the API there). Any trailing slash is stripped automatically. |
| **Username** | Yes | Your Taiga username or email. |
| **Password** | Yes | Your Taiga password. |

### Hosted vs. self-hosted

- **Hosted (taiga.io):** leave **API URL** as `https://api.taiga.io`.
- **Self-hosted:** set **API URL** to your instance's base URL. All calls are made against `{url}/api/v1`.

Use **Get Me** as a quick connection check — it returns the authenticated user's profile and confirms your credentials are valid.

## Data model

Taiga is **project-scoped**: user stories, tasks, issues, epics, and milestones all belong to a project.

- **Projects** are the top-level container. Reference a project by its numeric **ID** or by its **slug** (the human-readable identifier in project URLs).
- **User Stories** are the primary backlog items and can be assigned to a **Milestone** (sprint).
- **Tasks** break down a user story; each task can be attached to a parent user story.
- **Issues** track bugs and requests, categorized by priority, severity, type, and status.
- **Epics** group related user stories across sprints.
- **Milestones (Sprints)** are time-boxed iterations with estimated start/finish dates.

Statuses, priorities, severities, and issue types are configured per project and referenced by their **numeric IDs** — fetch a project with **Get Project** to see the IDs available for that project.

## Updates and optimistic locking

Taiga uses **optimistic concurrency control**. Every update (**Update User Story**, **Update Task**, **Update Issue**) requires the object's current **`version`** number. Fetch the object first (e.g. **Get User Story**), read its `version`, and pass that value to the update. If the version is stale — because someone else changed the object in the meantime — the update is rejected so you never silently overwrite concurrent edits.

## Errors

Taiga returns a `_error_message` for general errors and per-field arrays for validation errors. The service surfaces the relevant message along with the HTTP status code, e.g. `Taiga API error (400): subject: This field is required.`

## Agent Ideas

- Use **GitHub** "Get Issues" to pull open bug reports from a repository, then call **Taiga** "Create Issue" to mirror each one into a Taiga project with the appropriate type, priority, and severity
- When a **Slack** "On Channel Message" trigger fires with a feature request, use **Taiga** "Create User Story" to log it and reply via **Slack** "Send Message To Channel" with the new story's ref
- On a recurring schedule, use **Taiga** "List User Stories" filtered by milestone and **Google Sheets** "Add Row" to append each story's status and points into a sprint-tracking spreadsheet
