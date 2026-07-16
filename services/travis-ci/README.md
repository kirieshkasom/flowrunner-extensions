# Travis CI FlowRunner Extension

Integrates with the Travis CI REST API (v3) to manage repositories, trigger and control builds and jobs, inspect job logs, and configure environment variables, branches, and caches. Authenticates with an API token and supports both the `travis-ci.com` and legacy `travis-ci.org` platforms.

## Ideal Use Cases

- Trigger builds on specific branches as part of a deployment or release automation
- Cancel, restart, or monitor builds and jobs in response to external events
- Fetch raw job logs for failure analysis, alerting, or archival
- Manage repository environment variables programmatically across projects
- Activate or deactivate repositories to control which projects Travis CI builds

## List of Actions

### Repositories
- Activate Repository
- Deactivate Repository
- Get Repository
- List Repositories
- Star Repository
- Unstar Repository

### Builds
- Cancel Build
- Get Build
- List Builds
- Restart Build
- Trigger Build

### Jobs
- Cancel Job
- Get Job
- Get Job Log
- List Build Jobs
- Restart Job

### Environment Variables
- Create Environment Variable
- Delete Environment Variable
- List Environment Variables

### Branches & Caches
- List Branches
- List Caches

### User
- Get Current User

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| **API Token** | Yes | Your Travis CI API token from Settings → API authentication. Sent as an `Authorization: token <token>` header. |
| **Domain** | Yes | `travis-ci.com` (default) for private and public repositories, or the legacy `travis-ci.org`. Determines the base URL, e.g. `https://api.travis-ci.com`. |

Every request also sends the `Travis-API-Version: 3` header automatically.

## Notes

- Repositories are identified by their **slug** (`owner/name`, e.g. `travis-ci/travis-web`). Provide the plain slug; the service URL-encodes the slash to `owner%2Fname` when building the request path. Builds and jobs are identified by their numeric IDs.
- Activate, Deactivate, and environment-variable actions require admin access to the repository.
- Values of private (non-public) environment variables are not returned by List Environment Variables.
- Errors surface the Travis API `error_message`, `error_type`, and HTTP status where available.

## Agent Ideas

- When a **Travis CI** "Get Build" reports a failed state, use **Slack** "Send Message To Channel" to alert the team with the build's branch, commit, and a link to the job log.
- After a **GitHub** "Create Pull Request", call **Travis CI** "Trigger Build" on the PR's branch to run CI and then **GitHub** "Create Issue Comment" to post the resulting build state back on the PR.
- When a **Travis CI** "Get Job Log" surfaces a recurring failure, use **GitHub** "Create Issue" to open a tracked bug with the log excerpt and repository slug.
