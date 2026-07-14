# Grafana FlowRunner Extension

Integrate [Grafana](https://grafana.com/) with FlowRunner to manage dashboards, folders, and data sources, record annotations, query metrics, and inspect alert rules, contact points, and organization users through the Grafana HTTP API. Authenticates with a server URL plus a service-account Bearer token, and works with both Grafana Cloud and self-hosted instances.

## Ideal Use Cases

- Programmatically create, update, and delete dashboards and folders as part of provisioning or CI/CD workflows.
- Record annotations on dashboards to mark deploys, incidents, or other events on time-series graphs.
- Query data sources directly to feed metrics into automations or alert conditions.
- Audit alert rules, contact points, and organization users, or run a health check for uptime monitoring.

## List of Actions

### Dashboards

- Search Dashboards
- Get Dashboard by UID
- Create or Update Dashboard
- Delete Dashboard
- Get Home Dashboard

### Folders

- List Folders
- Get Folder
- Create Folder
- Delete Folder

### Data Sources

- List Data Sources
- Get Data Source
- Create Data Source
- Query Data Source

### Annotations

- Create Annotation
- List Annotations
- Delete Annotation

### Alerting

- List Alert Rules
- Get Alert Rule
- List Contact Points

### Organization & Users

- Get Organization
- List Organization Users
- Get Current User
- Health Check

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Server URL** | Yes | Your Grafana URL, e.g. `https://myorg.grafana.net` or a self-hosted address (e.g. `https://grafana.example.com`). Trailing slashes are trimmed and `/api` is appended automatically. |
| **API Token** | Yes | A Grafana service account token, sent as a `Bearer` credential on every request. |

### Creating a service account token

1. In Grafana, go to **Administration → Users and access → Service accounts**.
2. Create a service account (or open an existing one) and assign it a role with the permissions your flows need (for example, **Editor** or **Admin**).
3. Choose **Add service account token**, give it a name, and copy the generated token.
4. Paste it into the **API Token** field.

> Legacy API keys (**Administration → API keys**) also work, but Grafana recommends service account tokens.

## Agent Ideas

- When a **PagerDuty** "On New Triggered Incident" trigger fires, use **Grafana** "Create Annotation" to mark the incident start time on the relevant dashboard for correlation with the metric spike.
- After a deploy, use **Grafana** "Create Annotation" to record the release on a dashboard, then post the annotation with **Slack** "Send Message To Channel" so the team can jump straight to the graph.
- When a **Grafana** "Health Check" reports the instance is unhealthy, use **PagerDuty** "Create Incident" to page the on-call engineer.
