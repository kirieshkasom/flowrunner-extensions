# CircleCI FlowRunner Extension

Integrate [CircleCI](https://circleci.com) CI/CD with FlowRunner. Trigger and inspect pipelines, workflows, and jobs, and manage project environment variables using the CircleCI API v2. Authenticates with a Personal API Token sent as the `Circle-Token` header.

## Ideal Use Cases

- Kick off a deployment or test pipeline from an automation when code is merged or a form is submitted
- Poll pipeline, workflow, and job status to gate downstream steps on a green build
- Cancel or rerun stuck or failed workflows without opening the CircleCI dashboard
- Collect job artifacts and test metadata for reporting or notifications
- Manage project environment variables and inspect checkout keys programmatically

## List of Actions

### Pipelines
- Trigger Pipeline
- Get Pipeline
- Get Pipeline by Number
- List Project Pipelines
- List My Pipelines
- Get Pipeline Config
- Get Pipeline Workflows

### Workflows
- Get Workflow
- Get Workflow Jobs
- Cancel Workflow
- Rerun Workflow

### Jobs
- Get Job Details
- Cancel Job
- Get Job Artifacts
- Get Test Metadata

### Project
- Get Project
- List Env Vars
- Create Env Var
- Delete Env Var
- List Checkout Keys

### Account
- Get Current User

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses a **Personal API Token**, sent on every request as the `Circle-Token` header.

1. Sign in to CircleCI.
2. Go to **User Settings → Personal API Tokens**.
3. Create a token and paste it into the **API Token** configuration item.

## Project Slug

Most operations require a **project slug** identifying the project:

- VCS form: `vcs-slug/org-name/repo-name` — e.g. `gh/acme/app` (GitHub) or `bb/acme/app` (Bitbucket).
- ID form (GitHub App / GitLab): `circleci/{orgId}/{projectId}`.

## Notes

- Values of environment variables are always masked by CircleCI (last four characters only).
- Artifact download URLs require the API token to be appended when fetching.

## Agent Ideas

- After a **CircleCI** "Trigger Pipeline" run reaches a failed state via "Get Pipeline Workflows", use **PagerDuty** "Create Incident" to page the on-call engineer with the failing workflow details.
- When a **CircleCI** "Get Job Artifacts" call returns build output, use **Slack** "Send Message To Channel" to post the artifact download links to the team's deploys channel.
- Combine **CircleCI** "Get Test Metadata" with **Slack** "Send Message To Channel" to broadcast a summary of failing tests to the team after each pipeline finishes.
