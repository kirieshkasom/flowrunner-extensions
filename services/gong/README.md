# Gong FlowRunner Extension

Bring Gong's revenue-intelligence data into your FlowRunner automations. Read and upload calls, pull AI-derived call insights and transcripts, retrieve user activity and interaction stats, work with the call library and scorecards, schedule integration meetings, run GDPR/CCPA data-privacy lookups and erasures, read audit logs, and manage permission profiles. Sync your own CRM objects and field schema into Gong's Generic CRM integration, and automate Gong Engage flows by assigning or removing prospects and inspecting their flow assignments - all from the no-code editor.

Authentication uses Gong's HTTP Basic API key: a Technical Administrator mints an Access Key and Access Key Secret in Company Settings -> Ecosystem -> API and enables the scopes each action needs. Provide both in the service configuration (Access Key as the Basic-auth username, Access Key Secret as the password).

## Ideal Use Cases

- Sync new calls into a data warehouse or CRM as they are processed (On New Call trigger).
- Summarize or search call transcripts and AI content (topics, brief, key points) in downstream nodes.
- Build rep-activity and conversation-interaction dashboards (talk ratio, calls hosted/attended).
- Upload calls from a non-integrated telephony system, then attach the recording media.
- Automate GDPR/CCPA right-to-be-forgotten lookups and erasures by email or phone.
- Push externally-scheduled meetings into Gong and audit API usage via logs.
- Sync accounts, contacts, deals, and leads from your own CRM into Gong's Generic CRM integration, defining the tracked field schema first.
- Automate Gong Engage outreach: assign new prospects to a flow, look up which flows a prospect is in, and remove them when a deal closes.

## List of Actions

### Calls
- Add Call
- Get Call
- Get Call Transcripts
- Get Extensive Call Data
- List Calls
- Upload Call Media

### Users
- Get User
- List Users
- List Users (Extensive)

### Workspaces
- List Workspaces

### Library
- List Calls in Folder
- List Library Folders

### Stats
- Get Activity by Period
- Get Aggregated Activity
- Get Day-by-Day Activity
- Get Interaction Stats

### Scorecards
- Get Answered Scorecards
- List Scorecards

### Meetings
- Create Meeting
- Delete Meeting
- Get Meeting Integration Status
- Update Meeting

### Data Privacy
- Erase Data for Email
- Erase Data for Phone
- Get Data for Email
- Get Data for Phone

### Logs
- List Logs

### Permission Profiles
- Get Permission Profile
- List Permission Profile Users
- List Permission Profiles

### CRM
- Register CRM Integration
- List CRM Integrations
- Delete CRM Integration
- Upload CRM Objects
- Get CRM Objects
- Upload CRM Object Schema
- List CRM Object Schema Fields
- Get CRM Request Status

### Flows
- List Flows
- Assign Prospects to Flow
- Get Prospects' Assigned Flows
- Remove Prospect from Flow by CRM ID
- Remove Prospects from Flow by Instance ID

## List of Triggers

- On New Call

## Agent Ideas

- When a **Gong** "On New Call" trigger fires, chain **Gong** "Get Call Transcripts" and then **Gmail** "Send Message" to email the account owner an AI-written recap of the conversation.
- Use **Gong** "Get Aggregated Activity" to pull per-rep call counters over a date range, then **Google Sheets** "Add Row" to append each rep's numbers into a weekly activity leaderboard.
- When a **Gong** "On New Call" trigger fires, use **Slack** "Send Message To Channel" to post the call title, host, and link to the deal team the moment the recording is available.
- Use **Google Sheets** "Get Rows" to read a list of new leads and their CRM IDs, then call **Gong** "Assign Prospects to Flow" to enroll each one in a Gong Engage outreach flow.
