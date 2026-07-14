# TheHive FlowRunner Extension

FlowRunner integration for [TheHive](https://strangebee.com/thehive/), the open-source Security Incident Response Platform (SIRP). This service targets the **TheHive 5** REST API (`/api/v1`) and automates SOC incident response — managing cases, tasks, observables, and alerts — from your FlowRunner flows. It authenticates with an API key sent as a Bearer token.

## Ideal Use Cases

- Auto-create a case from an external alert (SIEM, email, ticketing) and scaffold its investigation tasks.
- Ingest alerts from threat feeds, then triage and promote or merge them into cases.
- Enrich cases by attaching IPs, domains, hashes, and URLs as observables, flagging IOCs and sightings.
- Advance task status and update case fields as an investigation progresses.
- Report on open cases and alerts using keyword filters or the raw query DSL.

## List of Actions

### Cases

- Create Case
- Get Case
- Update Case
- Delete Case
- List Cases

### Tasks

- Create Task
- Get Task
- Update Task
- List Case Tasks

### Observables

- Create Observable
- Get Observable
- List Case Observables

### Alerts

- Create Alert
- Get Alert
- Update Alert
- Promote Alert to Case
- Merge Alert into Case
- List Alerts

### Query

- Run Query

## List of Triggers

This service does not define any triggers.

## Authentication

TheHive authenticates with an **API key** sent as a Bearer token (`Authorization: Bearer <apiKey>`). Configure two items when connecting the service:

| Config item      | Required | Description                                                                                              |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| **Instance URL** | Yes      | Your TheHive base URL, e.g. `https://thehive.example.com`. Any trailing slash is stripped automatically. |
| **API Key**      | Yes      | A TheHive API key. Create one under **TheHive → your profile → API keys → create a key**.                |

All requests are made against `{Instance URL}/api/v1`.

## Data Model

- **Case** — the central container for an investigation. Groups tasks, observables, and notes.
- **Task** — a step in an investigation, optionally grouped and assigned.
- **Observable** — a piece of technical evidence (IP, domain, URL, hash, email, etc.), optionally flagged as an Indicator of Compromise (`ioc`) or `sighted`.
- **Alert** — a notification from an external source (SIEM, email gateway, threat feed). Alerts are triaged and can be **promoted** to a new case or **merged** into an existing one.

### Severity, TLP, and PAP

These operations accept friendly labels that are translated to TheHive's numeric codes:

| Field        | Labels → API value                                   |
| ------------ | ---------------------------------------------------- |
| **Severity** | `Low` → 1, `Medium` → 2, `High` → 3, `Critical` → 4  |
| **TLP**      | `WHITE` → 0, `GREEN` → 1, `AMBER` → 2, `RED` → 3     |
| **PAP**      | `WHITE` → 0, `GREEN` → 1, `AMBER` → 2, `RED` → 3     |

TLP (Traffic Light Protocol) controls how widely information may be shared; PAP (Permissible Actions Protocol) controls what actions may be taken on it.

## The Query DSL

TheHive 5 has no simple list endpoints; listing and searching are done by posting a **query pipeline** to `POST /query`. The body is `{ "query": [ ...stages ] }`, where each stage is an object with a `_name` and stage-specific properties. Stages run left to right, each feeding the next.

Common stages:

- `{ "_name": "listCase" }` / `{ "_name": "listAlert" }` — start from all cases/alerts.
- `{ "_name": "getCase", "idOrName": "~8200" }` — start from a specific case.
- `{ "_name": "tasks" }` / `{ "_name": "observables" }` — traverse to related entities.
- `{ "_name": "filter", "_field": "status", "_value": "New" }` — filter results (supports `_like`, `_and`, `_or`, `_gt`, `_lt`, etc.).
- `{ "_name": "sort", "_fields": [{ "_createdAt": "desc" }] }` — order results.
- `{ "_name": "page", "from": 0, "to": 25 }` — paginate (`from` inclusive, `to` exclusive).

Example — the newest 25 open cases:

```json
{
  "query": [
    { "_name": "listCase" },
    { "_name": "filter", "_field": "status", "_value": "New" },
    { "_name": "sort", "_fields": [{ "_createdAt": "desc" }] },
    { "_name": "page", "from": 0, "to": 25 }
  ]
}
```

The **List Cases**, **List Alerts**, **List Case Tasks**, and **List Case Observables** operations build these pipelines for you. For anything more advanced, use **Run Query** and pass the pipeline directly.

## Errors

TheHive returns errors as `{ "type": "...", "message": "..." }` (or an array of such objects) along with an HTTP status code. This service surfaces both the message and the status in the thrown error so failures are easy to diagnose in a flow.

## Agent Ideas

- When a **Slack** "On Channel Message" trigger reports a suspicious event, use **TheHive** "Create Alert" to open an investigation, then post the case link back with **Slack** "Send Message To Channel".
- Use **Gmail** "On New Email" to catch phishing reports, call **TheHive** "Create Alert" with the sender and URLs as observables, then "Promote Alert to Case" once triaged.
- After **TheHive** "List Cases" or "Run Query" returns open incidents, use **Google Sheets** "Add Row" to log each case's number, severity, and status into an incident tracking spreadsheet.
