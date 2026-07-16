# Netlify FlowRunner Extension

Integrate [Netlify](https://www.netlify.com/) with FlowRunner to manage sites, deploys, environment variables, forms, and DNS. Authenticates with a Netlify personal access token (sent as a Bearer token).

## Ideal Use Cases

- Trigger a new build/deploy from a connected Git repository as part of a release workflow, then monitor its state.
- Roll back to a known-good deploy (lock/restore) when a bad release is detected.
- Sync environment variables across sites and deploy contexts (production, deploy previews, branch deploys).
- Collect and process Netlify Forms submissions, then archive or clean them up.
- Manage Netlify DNS zones and records programmatically.

## Authentication

Provide a Netlify **personal access token** via the **API Token** config item (create one in Netlify → User settings → Applications → Personal access tokens).

The optional **Account ID** config item is required only for the Environment Variable operations. Discover it with the **List Accounts** operation (the account `id` field) or find it in Netlify → Team settings.

## List of Actions

### Sites
- Create Site
- Delete Site
- Get Site
- List Sites
- Update Site

### Deploys
- Cancel Deploy
- Get Deploy
- List Deploys
- Lock Deploy
- Restore Deploy
- Trigger Build
- Unlock Deploy

### Environment Variables (require Account ID)
- Create Environment Variable
- Delete Environment Variable
- Get Environment Variable
- List Environment Variables
- Set Environment Variable Value

### Forms
- Delete Form Submission
- List Form Submissions
- List Forms

### DNS
- Create DNS Record
- Delete DNS Record
- List DNS Records
- List DNS Zones

### Account
- List Accounts

## List of Triggers

This service does not define any triggers.

## Notes

- Netlify deploys are file-digest based; direct file uploads are not exposed. Use **Trigger Build** to deploy from a connected repository, or **Restore Deploy** to republish a previous deploy.
- Environment variables use Netlify's account-scoped v1 Environment Variables API and support per-context values (`all`, `production`, `deploy-preview`, `branch-deploy`, `dev`).

## Agent Ideas

- When a **GitHub** "Get Workflows" run or push signals a release is ready, call **Netlify** "Trigger Build" to deploy the site, then use "Get Deploy" to confirm it reaches the `ready` state.
- After **Netlify** "List Form Submissions" returns new entries, use **Slack** "Send Message To Channel" to notify the team of each new submission, then "Delete Form Submission" to clear processed entries.
- When a bad release is detected, use **Netlify** "List Deploys" to find the last good deploy and "Restore Deploy" to roll back, then post an alert with **Slack** "Send Message To Channel".
