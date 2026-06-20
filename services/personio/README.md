# Personio FlowRunner Extension

Integration with the Personio HR platform for managing people, employments, time off, time tracking, documents, recruiting, reports, compensations, and projects. Authenticates with Personio API credentials, plus an optional Recruiting Token for candidate workflows.

## Ideal Use Cases

- Automating onboarding and offboarding of employee records
- Syncing time-off requests, balances, and attendance
- Tracking work hours against projects
- Managing employee documents, uploads, and downloads
- Creating recruiting candidates and uploading applicant CVs
- Running Personio reports and pushing results elsewhere
- Monitoring HR changes in real time to trigger workflows

## List of Actions

- Add Compensation
- Add Person
- Add Project
- Create Candidate
- Delete Document
- Delete Person
- Delete Project
- Delete Time Entry
- Download Document
- End Employment
- Find Compensations
- Find Cost Centers
- Find Departments
- Find Documents
- Find Employments
- Find Legal Entities
- Find Offices
- Find People
- Find Project Members
- Find Projects
- Find Time Entries
- Find Time Off
- Find Webhooks
- Get Employee Photo
- Get Time Off Balance
- Inspect Webhook
- List Report Columns
- Request Time Off
- Run Report
- Summarize Time Tracked
- Test Connection
- Track Time
- Update Document Details
- Update Employment
- Update Person
- Update Project
- Update Project Members
- Update Time Entry
- Update Time Off
- Upload Applicant Document
- Upload Document
- Withdraw Time Off Request

## List of Triggers

- On Document Change
- On Employment Change
- On People Change
- On Time Off Change
- On Time Tracking Change

## Agent Ideas

- When a **Personio** "On People Change" trigger fires for a new hire, use **Slack** "Send Direct Message" to welcome them and **Slack** "Invite User To Channel" to add them to their team channel
- When a **Personio** "On Time Off Change" trigger fires, use **Google Sheets** "Add Row" to log the absence into a shared time-off tracker and **Gmail** "Send Message" to notify the manager
- Use **Personio** "Run Report" to pull a headcount report, then call **Google Sheets** "Add Rows" to sync the results into a reporting spreadsheet for dashboards
