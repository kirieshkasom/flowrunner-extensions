# Jenkins FlowRunner Extension

Integrate [Jenkins](https://www.jenkins.io/) with FlowRunner to manage jobs, trigger and monitor builds, inspect the build queue, and query system information through the Jenkins remote access API.

## Ideal Use Cases

- Trigger a Jenkins build (with parameters) as part of a larger automation and follow it to completion.
- Create, copy, enable/disable, or delete jobs programmatically from a workflow.
- Capture build results and console output for reporting, alerting, or archiving.
- Monitor the build queue and cancel stuck or unwanted queued builds.
- Pull Jenkins version, mode, and view information for dashboards and health checks.

## Authentication

This service authenticates with HTTP Basic authentication using your Jenkins username and a personal **API token** (not your password). Three configuration values are required:

| Config | Description |
| --- | --- |
| **Jenkins URL** | Your Jenkins base URL, e.g. `https://jenkins.example.com`. Any trailing slash is stripped automatically. |
| **Username** | The Jenkins username that owns the API token. |
| **API Token** | A Jenkins API token for that user. |

### Creating an API token

1. Sign in to Jenkins.
2. Click your **name** in the top-right corner, then **Configure**.
3. Under **API Token**, click **Add new token**, give it a name, and click **Generate**.
4. Copy the generated token immediately (Jenkins shows it only once) and paste it into the **API Token** configuration field.

## Job paths and folders

Jenkins jobs can live at the top level or inside folders. Wherever an operation asks for a **Job Path**:

- A top-level job is just its name, e.g. `my-app-build`.
- A job inside folders uses a forward-slash path, e.g. `my-folder/my-job` or `my-folder/sub-folder/my-job`.

The service translates these paths into Jenkins' `/job/.../job/...` URL structure automatically. The **Get Jobs** dictionary lists top-level jobs for convenient selection; jobs nested inside folders must be entered as a folder path manually.

## CSRF crumbs

Jenkins typically protects write operations (POST) with CSRF crumbs. This service automatically requests a crumb from `/crumbIssuer/api/json` and attaches it to write requests. If crumb protection is disabled on your instance (the crumb issuer responds with `404`), the service simply proceeds without one. A `403` response on a write operation usually indicates a crumb or permissions problem.

## List of Actions

### Jobs
- Copy Job
- Create Job
- Delete Job
- Disable Job
- Enable Job
- Get Job
- Get Job Config
- List Jobs

### Builds
- Get Build
- Get Build Console Output
- Get Build Log Tail
- Stop Build
- Trigger Build

### Queue
- Cancel Queue Item
- Get Queue

### System
- Get Jenkins Info
- Get Views

## List of Triggers

This service does not define any triggers.

## Notes on triggering builds

Jenkins does not run builds immediately - it places them in a queue. **Trigger Build** therefore returns the **queue item location/ID** rather than a build number. Poll **Get Queue**, or use **Get Build** with the `lastBuild` alias, to follow the build once it leaves the queue and starts executing.

## Agent Ideas

- When a **GitHub** push or new pull request arrives, call Jenkins "Trigger Build" for the corresponding job, then use **GitHub** "Create Issue Comment" to post the resulting build status back onto the pull request.
- After Jenkins "Get Build" reports a failed result, use **PagerDuty** "Create Incident" to page the on-call engineer, including the failing job and the console output from "Get Build Console Output".
- When Jenkins "Trigger Build" completes, use **Slack** "Send Message To Channel" to notify the team with the build result, duration, and a link to the console log.
