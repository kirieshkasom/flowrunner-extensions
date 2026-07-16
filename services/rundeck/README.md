# Rundeck FlowRunner Extension

FlowRunner integration for [Rundeck](https://www.rundeck.com/), a runbook automation and job scheduler. Flows can list projects and jobs, run and retry jobs, run adhoc commands and scripts, and inspect or control executions. Authenticates with a Rundeck User API Token sent as the `X-Rundeck-Auth-Token` header against a configurable API version.

## Ideal Use Cases

- Trigger a Rundeck job as part of a larger workflow, passing option values, then track the resulting execution to completion.
- Kick off deployment or maintenance runbooks and poll their status, state, and log output.
- Run adhoc shell commands or scripts across project nodes without defining a job.
- Retry failed executions, abort runaway runs, and audit or clean up execution history.
- Verify server connectivity and browse available projects and jobs before automating.

## List of Actions

- **Projects** — List Projects, Get Project
- **Jobs** — List Jobs, Get Job Definition, Run Job, Retry Job Execution
- **Executions** — Get Execution, Get Execution State, Get Execution Output, Abort Execution, List Project Executions, Delete Execution
- **Adhoc** — Run Adhoc Command, Run Adhoc Script
- **System** — Get System Info

## List of Triggers

This service does not define any triggers.

## Configuration

- **Server URL** (required) — Your Rundeck server URL, e.g. `https://rundeck.example.com` (strip any trailing slash).
- **API Token** (required) — Created in Rundeck under Profile → User API Tokens; sent as the `X-Rundeck-Auth-Token` header.
- **API Version** (optional, default `47`) — Requests are sent to `{Server URL}/api/{API Version}`. Lower it if your server is older. Use **Get System Info** to confirm the URL, version, and token are valid.

## Notes

- **Core model** — Projects group jobs, nodes, and configuration; most operations are scoped to a project by name (use List Projects or the project dropdown). Jobs are predefined workflows identified by a UUID (use List Jobs / the project-dependent job dropdown). Executions are individual runs identified by a numeric ID, returned by Run Job and adhoc operations.
- **Running a job with options** — Run Job returns the created execution immediately without waiting for completion. Supply option values via the **Options** parameter as key/value pairs (e.g. `{ "version": "1.2.3", "environment": "prod" }`), which takes precedence over **Arg String**. Optionally set a Node Filter, Log Level, As User, or Run At Time. Track progress with Get Execution / Get Execution State, and use Retry Job Execution to re-run only the failed nodes.

## Agent Ideas

- After a **Jenkins** "Trigger Build" completes, call **Rundeck** "Run Job" to execute the deployment runbook for the new artifact, then poll "Get Execution State" until it finishes.
- When a **Rundeck** execution fails, use "Get Execution Output" to capture the logs and **PagerDuty** "Create Incident" to alert the on-call engineer with the failure details.
- Use **Rundeck** "List Project Executions" to summarize recent runs, then post the results to a channel with **Slack** "Send Message To Channel".
