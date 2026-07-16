# Sentry FlowRunner Extension

FlowRunner service for [Sentry](https://sentry.io) — application error monitoring and performance tracking. Manage projects, triage issues, inspect events, and coordinate releases and deploys directly from your flows. Authenticates with a Sentry auth token.

## Ideal Use Cases

- Auto-triage new issues by resolving, ignoring, or assigning them based on rules in your flow.
- Fan out critical error notifications to chat, on-call, or ticketing tools.
- Record releases and deploys as part of a CI/CD pipeline so Sentry can associate errors with the right version.
- Pull issue and event details into reports, spreadsheets, or downstream dashboards.
- Provision new projects under a team and keep their platform and slug in sync.

## Configuration

| Config item | Required | Description |
| --- | --- | --- |
| **Auth Token** | Yes | A Sentry auth token. Create one under **Settings → Auth Tokens**, or use an **Internal Integration** token. It is sent as `Authorization: Bearer <token>`. |
| **Organization Slug** | Yes | Your organization slug, taken from the URL `sentry.io/organizations/{slug}`. |
| **Base URL** | No | Base URL of your Sentry instance. Defaults to `https://sentry.io` for Sentry SaaS. For **self-hosted Sentry**, set this to your instance URL (e.g. `https://sentry.example.com`). The API path `/api/0` is appended automatically. |

### Token scopes

Grant the token the scopes needed for the operations you use:

- `project:read` — list/get projects, list issues and events
- `project:write` / `project:admin` — create and update projects
- `event:read` — read events
- `event:write` / `event:admin` — update and delete issues
- `project:releases` — list, create, and delete releases and create deploys
- `team:read` — list teams

## List of Actions

### Projects
- **List Projects** — all projects in the organization.
- **Get Project** — full details of a project by slug.
- **Create Project** — create a project under a team.
- **Update Project** — rename, re-slug, or change a project's platform.

### Issues
- **List Issues** — issues for a project, filtered with Sentry search syntax (e.g. `is:unresolved`).
- **Get Issue** — details of a single issue.
- **Update Issue** — resolve, unresolve, or ignore an issue, and set its assignee.
- **Delete Issue** — permanently delete an issue and its events.
- **List Issue Events** — occurrences that belong to an issue.
- **Get Latest Event** — the most recent event for an issue.

### Events
- **List Project Events** — all events for a project.
- **Get Event** — a single event by id within a project.

### Releases
- **List Releases** — releases for the organization.
- **Create Release** — create a release for one or more projects.
- **Get Release** — details of a release by version.
- **Delete Release** — delete a release (only if it has no events).
- **Create Deploy** — record a deploy of a release to an environment.

### Teams
- **List Teams** — all teams in the organization.

## List of Triggers

This service does not define any triggers.

## Notes

- **Pagination:** Sentry uses cursor-based pagination via the HTTP `Link` header. The `Link` header may not be accessible in this environment, so full automatic pagination can be limited. List operations accept a `cursor` query parameter that you can supply manually when a cursor value is available.
- **Self-hosted:** set **Base URL** to your instance; all endpoints and the `/api/0` prefix work identically.

## Agent Ideas

- Run a scheduled flow using **Sentry** "List Issues" with `is:unresolved`, then use **GitHub** "Create Issue" to open a tracking ticket for each new bug and **Sentry** "Update Issue" to assign it.
- When **Sentry** "List Issues" surfaces a new critical issue, use **PagerDuty** "Create Incident" to page the on-call engineer and **Slack** "Send Message To Channel" to alert the team channel with a link to the issue.
- After a deployment flow completes, call **Sentry** "Create Release" and "Create Deploy" to record the version, then use **Google Sheets** "Add Row" to log the release version, environment, and timestamp for audit tracking.
