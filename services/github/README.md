# GitHub FlowRunner Extension

Comprehensive GitHub integration via OAuth2 for managing repositories, issues, pull requests, branches, files, releases, organizations, teams, gists, webhooks, secrets, variables, and more. Includes polling triggers that react to repository, issue, pull request, and account activity. Requires a GitHub OAuth App (Client ID and Client Secret) to authenticate.

## Ideal Use Cases

- Automating repository lifecycle tasks such as creating repos, branches, files, and releases
- Triaging and managing issues and pull requests, including labels, milestones, assignees, and comments
- Synchronizing GitHub activity (new issues, PRs, pushes, releases, stars) into downstream flows
- Managing organizations, teams, collaborators, and membership programmatically
- Maintaining CI/CD configuration through repository, organization, and environment secrets and variables
- Publishing gists and triggering repository dispatch events for custom workflow automation
- Monitoring notifications, mentions, and review requests for a connected GitHub account

## List of Actions

- Add Collaborator
- Add Label to Issue/PR
- Add Team Member
- Add Team Repository
- Assign Issue/PR
- Check Organization Membership
- Create Branch
- Create Deploy Key
- Create Discussion
- Create Discussion Comment
- Create Environment Secret
- Create Environment Variable
- Create File
- Create Gist
- Create Issue
- Create Issue Comment
- Create Label
- Create Milestone
- Create Organization Project
- Create Organization Repository
- Create Organization Secret
- Create Organization Variable
- Create Pull Request
- Create Release
- Create Repository
- Create Repository Dispatch Event
- Create Repository Project
- Create Repository Secret
- Create Repository Variable
- Create Repository Webhook
- Create Team
- Delete Branch
- Delete Deploy Key
- Delete Environment Secret
- Delete Environment Variable
- Delete File
- Delete Gist
- Delete Label
- Delete Milestone
- Delete Organization Secret
- Delete Organization Variable
- Delete Project
- Delete Release
- Delete Repository
- Delete Repository Secret
- Delete Repository Variable
- Delete Repository Webhook
- Delete Team
- Find Branch
- Find Issue
- Find Organization
- Find or Create Issue
- Find or Create Pull Request
- Find Pull Request
- Find Repository
- Find User
- Fork Repository
- Get Current User
- Merge Pull Request
- Remove Collaborator
- Remove Label from Issue/PR
- Remove Team Member
- Remove Team Repository
- Star Repository
- Unassign Issue/PR
- Unstar Repository
- Unwatch Repository
- Update File
- Update Issue
- Update Label
- Update Milestone
- Update Organization Variable
- Update Repository Variable
- Update Environment Variable
- Watch Repository

## List of Triggers

- New Branch
- New Collaborator
- New Commit
- New Commit Comment
- New Gist
- New Global Event
- New Label
- New Mention
- New Milestone
- New Notification
- New Organization
- New Repo Event
- New Repository
- New Review Request
- New Team
- New Watcher
- On Issue Opened
- On Pull Request Opened
- On Push
- On Release Published
- On Star

## Agent Ideas

- When a **GitHub** "On Issue Opened" trigger fires, use **Slack** "Send Message" to notify the engineering channel with the issue title, author, and link
- Use **Gmail** "On New Email" to capture inbound bug reports, then call **GitHub** "Find or Create Issue" to file or update a matching issue in the target repository
- When a **GitHub** "On Release Published" trigger fires, use **Trello** "Create Card" to open a QA/release-tracking card with the release notes and tag
