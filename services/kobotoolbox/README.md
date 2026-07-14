# KoBoToolbox FlowRunner Extension

Integrate [KoBoToolbox](https://www.kobotoolbox.org/) to manage forms (assets), read and manage collected data (submissions), and generate data exports. Built on the KoBoToolbox KPI v2 REST API and authenticated with an account API token (`Authorization: Token`).

## Ideal Use Cases

- Automatically pull new survey submissions into spreadsheets, databases, or notifications as they arrive
- Filter collected records with Mongo-style JSON queries for reporting and downstream processing
- Programmatically create, deploy, and redeploy survey forms across projects
- Generate CSV/XLS exports and route the download links to stakeholders
- Monitor submission counts and clean up records as part of data-management workflows

## List of Actions

### Assets

- Create Asset
- Deploy Asset
- Get Asset
- Get Asset Content
- Get Deployment
- List Assets
- Redeploy Asset

### Submissions

- Delete Submission
- Get Submission
- Get Submission Count
- Get Submissions

### Exports

- Create Export
- List Exports

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

Every request is sent with an `Authorization: Token <apiToken>` header to `{Server URL}/api/v2` with `format=json`.

- **Server URL** (required) — `https://kf.kobotoolbox.org` (global) or `https://eu.kobotoolbox.org` (EU). Trailing slashes are stripped; defaults to the global server.
- **API Token** (required) — Your personal API token, found in KoBoToolbox under **Account Settings → Security → API token**.

> **Global vs EU server:** KoBoToolbox runs separate global and EU deployments. Accounts, forms, and data are not shared between them — set **Server URL** to match the server where your account lives.

## Notes

- **Get Submissions** accepts an optional Mongo-style JSON **Query** applied server-side, e.g. `{"_submission_time": {"$gt": "2024-01-01"}}`, `{"gender": "female"}`, or `{"age": {"$gte": 18}, "region": "north"}`. The optional **Sort** uses the same convention, e.g. `{"_submission_time": -1}` for newest first.
- Exports are generated asynchronously. **Create Export** returns immediately; poll **List Exports** until an export's status is `complete` to obtain its download URL.
- Deleting a submission is permanent and cannot be undone.

## Agent Ideas

- After **Get Submissions** returns new records filtered by a Mongo-style query, use **Google Sheets** "Add Row" to append each submission into a reporting spreadsheet
- Call **Create Export** then **List Exports** to obtain a completed CSV/XLS download link, and use **Gmail** "Send Message" to email the export to stakeholders
- When a new asset is created with **Create Asset** and activated via **Deploy Asset**, use **Google Drive** "Upload File" to archive the exported response data for backup
