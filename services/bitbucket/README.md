# Bitbucket FlowRunner Extension

FlowRunner integration for [Bitbucket Cloud](https://bitbucket.org) via the Bitbucket Cloud REST API 2.0. Manage repositories, issues, pull requests, source files, branches, and pipelines within a workspace. Authenticates with HTTP Basic using your Atlassian account email plus an API token (App Passwords are deprecated).

## Ideal Use Cases

- Automatically open, comment on, and update issues in response to events from other systems.
- Create, review, approve, merge, or decline pull requests as part of a release workflow.
- Commit generated or synced files to a branch and track the resulting commits.
- Trigger, monitor, and stop CI/CD pipelines and report their status downstream.
- Manage branches and browse source files and directories programmatically.

## List of Actions

### Repositories
- Get Repository
- List Repositories

### Issues
- Add Issue Comment
- Create Issue
- Get Issue
- List Issues
- Update Issue

### Pull Requests
- Add Pull Request Comment
- Approve Pull Request
- Create Pull Request
- Decline Pull Request
- Get Pull Request
- List Pull Requests
- Merge Pull Request
- Unapprove Pull Request
- Update Pull Request

### Source
- Create or Update File
- Get File
- List Commits
- List Directory

### Branches
- Create Branch
- Delete Branch
- List Branches

### Pipelines
- Get Pipeline
- List Pipelines
- Stop Pipeline
- Trigger Pipeline

## List of Triggers

This service does not define any triggers.

## Configuration

| Setting | Description |
| --- | --- |
| **Account Email** | Your Atlassian account email address, used with the API token for Basic authentication. |
| **API Token** | An Atlassian API token created at id.atlassian.com > Security > API tokens (App Passwords are deprecated). |
| **Workspace ID** | Your workspace ID, taken from the URL `bitbucket.org/{workspace}`. All operations run against this workspace. |

## Notes

- The issue tracker must be enabled per repository for the Issues actions to work.
- Pipelines must be enabled for the repository before pipeline actions can run.
- Most operations take a repository slug (`repo_slug`) from `bitbucket.org/{workspace}/{repo_slug}`; the Get Repositories and Get Branches dictionaries supply these values for selection in the UI.

## Agent Ideas

- When a **GitHub** "On Pull Request Opened" trigger fires, use **Bitbucket** "Create Pull Request" to mirror the change into a Bitbucket repository, then **Slack** "Send Message To Channel" to notify reviewers with the PR link.
- Use **Jira** "Search Issues" to find issues marked ready for release, then call **Bitbucket** "Merge Pull Request" for each linked PR and **Bitbucket** "Trigger Pipeline" to deploy the merged branch.
- After **Bitbucket** "List Pipelines" reports a failed run, use **Jira** "Create Issue" to file a bug and **Slack** "Send Message To Channel" to alert the on-call engineer with the pipeline details.
