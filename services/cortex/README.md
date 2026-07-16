# Cortex FlowRunner Extension

FlowRunner integration for [Cortex](https://github.com/TheHive-Project/Cortex), the observable analysis and active-response engine from the TheHive Project. Cortex runs **analyzers** to enrich observables (IPs, domains, URLs, hashes, emails, files) against threat-intelligence sources and **responders** to take active actions (notify, block, ticket). This service drives the Cortex REST API so FlowRunner flows can start analyzer and responder jobs and collect their reports. Authentication uses a Cortex API key sent as a Bearer token.

## Ideal Use Cases

- Automatically enrich a suspicious IP, domain, hash, or URL with one or more Cortex analyzers and act on the verdict.
- Run a synchronous enrichment (start an analyzer, then block until its report is ready) inside a single automation step.
- Discover which analyzers can process a given observable type and pick one dynamically.
- Trigger active responders (block an indicator, send a notification, open a ticket) in response to an event.
- Review recent analysis history and pull structured reports, taxonomies, and extracted artifacts for downstream flows.

## List of Actions

### Analyzers
- List Analyzers
- Get Analyzer
- Get Analyzers by Type

### Run Analysis
- Run Analyzer
- Get Job
- Get Job Report
- Wait for Job Report
- List Jobs
- Delete Job

### Responders
- List Responders
- Run Responder
- Get Responder Job

## List of Triggers

This service does not define any triggers.

## Authentication

Cortex authenticates with an **API key** sent as a Bearer token (`Authorization: Bearer <apiKey>`). Requests are made against `{url}/api`.

| Config item | Required | Description |
| --- | --- | --- |
| **Instance URL** | Yes | Your Cortex URL, e.g. `https://cortex.example.com`. A trailing slash is stripped automatically; the API is called at `{url}/api`. |
| **API Key** | Yes | Create a user in Cortex under **Organization → Users**, then generate an API key for that user. |

## Notes

Analysis in Cortex is **asynchronous and job-based**:

1. **Discover** an analyzer with *List Analyzers*, *Get Analyzers by Type*, or the *Get Analyzers Dictionary* (used to pick an analyzer id in dependent parameters).
2. **Run** it with *Run Analyzer*, passing the observable value, its data type, and a TLP/PAP sharing level. This returns a **job** immediately with status `Waiting`/`InProgress`.
3. **Collect results** one of two ways:
   - Poll *Get Job* for status, then *Get Job Report* for the structured report; or
   - Call *Wait for Job Report*, which **blocks until the job finishes** (capped at one minute per request) and returns the report in a single step — ideal for synchronous enrichment flows.

Reports include a `summary` with taxonomies (`level`, `namespace`, `predicate`, `value`), a `full` object with the analyzer's raw output, and any extracted `artifacts`. **Responders** follow the same job model via *Run Responder* and *Get Responder Job*.

`TLP` (Traffic Light Protocol) and `PAP` (Permissible Actions Protocol) are provided as friendly labels mapped to Cortex numeric codes: **WHITE=0, GREEN=1, AMBER=2, RED=3**.

> **File observables:** analyzing a file requires a multipart upload and is not supported by this service. Use value-based observables (IP, domain, FQDN, URL, hash, mail, other).

## Agent Ideas

- When investigating a suspicious observable, use **Cortex** "Run Analyzer" then "Wait for Job Report" to enrich it, and record the verdict on the incident with **TheHive** "Create Observable" or "Update Case".
- After a **TheHive** "Create Alert" and "List Alerts" surface a new alert, use **Cortex** "Get Analyzers by Type" and "Run Analyzer" to auto-enrich its observables before **TheHive** "Promote Alert to Case".
- When a **Cortex** analyzer report flags a malicious indicator, use **Cortex** "Run Responder" to block it and **TheHive** "Create Alert" to open a tracked alert for the SOC team.
