# GitLab FlowRunner Extension

Integrate GitLab into FlowRunner to manage projects, issues, merge requests, repository content, CI/CD pipelines, and releases through the GitLab REST API v4. Works with both **GitLab SaaS** (gitlab.com) and **self-managed** GitLab instances.

## Ideal Use Cases

- Automatically create GitLab issues from support tickets, form submissions, or monitoring alerts
- Open, review, and merge merge requests as part of a release workflow
- Commit generated files or configuration changes into a repository branch
- Trigger, retry, or cancel CI/CD pipelines and react to their status
- Publish releases and notify stakeholders when they ship

## List of Actions

- **Projects** — List Projects, Get Project
- **Issues** — Create Issue, Get Issue, List Issues, Update Issue, Create Issue Note
- **Merge Requests** — Create Merge Request, Get Merge Request, List Merge Requests, Update Merge Request, Merge Merge Request, Add Merge Request Note
- **Repository** — List Branches, Create Branch, Delete Branch, Get File, Create or Update File, List Commits, Create Commit
- **Pipelines** — List Pipelines, Get Pipeline, Trigger Pipeline, Retry Pipeline, Cancel Pipeline
- **Releases** — List Releases, Create Release

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item      | Required | Description |
| ---------------- | -------- | ----------- |
| **Base URL**     | No       | For GitLab SaaS, use `https://gitlab.com` (the default). For a self-managed instance, set its URL, e.g. `https://gitlab.example.com`. Any trailing slash is stripped automatically. All requests target `{Base URL}/api/v4`. |
| **Access Token** | Yes      | A personal access token used for authentication (sent as the `PRIVATE-TOKEN` header). |

### Creating an access token

1. In GitLab, go to your avatar → **Preferences** → **Access Tokens** (or **Edit profile → Access Tokens**).
2. Create a token with the **`api`** scope.
3. Copy the generated token and paste it into the **Access Token** config item.

> The `api` scope grants full read/write access to the API, which is required for the write operations in this service (creating issues, merge requests, commits, pipelines, releases, etc.).

## Notes

- **Referencing projects**: Every operation takes a **Project** parameter. Supply either a numeric project ID (e.g. `12345`) or a namespaced path (e.g. `my-group/my-project`). The service URL-encodes the path automatically, so you do not need to encode slashes yourself. The **Get Projects** dictionary lists projects you are a member of and returns their numeric IDs for easy selection.
- Issues and merge requests are addressed by their project-scoped internal ID (**iid**), not the global database ID.

## Agent Ideas

- When a new bug report arrives, use **GitLab** "Create Issue" to file it, then use **Slack** "Send Message To Channel" to notify the engineering channel with the issue link.
- After **GitLab** "Merge Merge Request" completes, use **GitLab** "Create Release" to tag the version and **Gmail** "Send Message" to email stakeholders the release notes.
- Mirror tracked work from **Linear** "Create Issue" or **Jira** "Create Issue" into GitLab via "Create Issue", keeping engineering and project-management tools aligned.
