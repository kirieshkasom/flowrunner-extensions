# Pipedrive FlowRunner Extension

A FlowRunner extension that integrates Pipedrive CRM via OAuth2, providing comprehensive access to deals, leads, persons, organizations, products, activities, projects, and account administration.

## Ideal Use Cases

- Sync deals, leads, persons, and organizations between Pipedrive and other systems
- Automate pipeline and stage management as deals progress
- Log calls, activities, notes, and tasks against CRM records
- Search the CRM and enrich records from external data sources
- Manage products, files, filters, goals, and webhooks programmatically
- Administer users, roles, permission sets, and account settings

## Configuration

This is an OAuth2 service. It requires two shared configuration items:

- **Client ID** — Pipedrive OAuth2 client ID (shared)
- **Client Secret** — Pipedrive OAuth2 client secret (shared)

Authentication uses the standard OAuth2 authorization code flow; FlowRunner manages connection, callback handling, and automatic token refresh.

## List of Actions

- **Activities**: Create Activity, Get Activity, Update Activity, Delete Activity, List Activities, Delete Activities
- **Activity Fields**: List Activity Fields
- **Activity Types**: List Activity Types, Create Activity Type, Update Activity Type, Delete Activity Type, Delete Activity Types
- **Billing**: List Billing Add-ons
- **Call Logs**: List Call Logs, Create Call Log, Get Call Log, Delete Call Log, Attach Call Log Recording
- **Channels**: Create channel, Delete channel, Receives incoming message, Delete conversation
- **Currencies**: List Currencies
- **Deal Fields**: List Deal Fields, Create Deal Field, Get Deal Field, Update Deal Field, Delete Deal Field, Delete Deal Fields
- **Deals**: List Deals, Create Deal, Get Deal, Update Deal, Delete Deal, Delete Deals, Duplicate Deal, Merge Deals, Search Deals, List Deals Collection, List Archived Deals, Get Deals Summary, Get Archived Deals Summary, Get Deals Timeline, Get Archived Deals Timeline, List Deal Activities, List Deal Updates, List Deal Files, List Deal Flow, List Deal Mail Messages, List Deal Persons, List Deal Permitted Users, List Deal Participants, Add Deal Participant, Delete Deal Participant, List Deal Participants Updates, List Deal Followers, Add Deal Follower, Delete Deal Follower, List Deal Products, Add Deal Product, Update Deal Product, Delete Deal Product
- **Files**: List Files, Get File, Upload File, Create Remote File, Link Remote File, Update File, Download File, Delete File
- **Filters**: List Filters, Create Filter, Get Filter, Update Filter, Delete Filter, Delete Filters, List Filter Helpers
- **Goals**: Create new goal, Find goals, Update existing goal, Delete existing goal, Get result of goal
- **Item Search**: Search Items, Search Items by Field
- **Lead Labels**: List Lead Labels, Create Lead Label, Update Lead Label, Delete Lead Label
- **Lead Sources**: List Lead Sources
- **Leads**: List Leads, Create Lead, Get Lead, Update Lead, Delete Lead, List Archived Leads, Search Leads, List Lead Permitted Users
- **Legacy Teams**: List teams, Create new team, Get single team, Update team, List users in team, Create users to team, Delete users from team, List teams of user
- **Mailbox**: Get one mail message, Get mail threads, Get one mail thread, Update mail thread details, Delete mail thread, List mail messages of mail thread
- **Meetings**: Link User Provider, Delete User Provider Link
- **Note Fields**: List Note Fields
- **Notes**: List Notes, Create Note, Get Note, Update Note, Delete Note, List Note Comments, Add Note Comment, Get Note Comment, Update Note Comment, Delete Note Comment
- **Organization Fields**: List Organization Fields, Create Organization Field, Get Organization Field, Update Organization Field, Delete Organization Field, Delete Organization Fields
- **Organizations**: List Organizations, Create Organization, Get Organization, Update Organization, Delete Organization, Delete Organizations, Merge Organizations, Search Organizations, List Organizations Collection, List Organization Activities, List Organization Updates, List Organization Deals, List Organization Files, List Organization Flow, List Organization Mail Messages, List Organization Persons, List Organization Permitted Users, List Organization Followers, Add Organization Follower, Delete Organization Follower
- **Permission Sets**: List Permission Sets, Get Permission Set, List Permission Set Assignments
- **Person Fields**: List Person Fields, Create Person Field, Get Person Field, Update Person Field, Delete Person Field, Delete Person Fields
- **Persons**: List Persons, Create Person, Get Person, Update Person, Delete Person, Delete Persons, Merge Persons, Search Persons, List Persons Collection, List Person Activities, List Person Updates, List Person Deals, List Person Files, List Person Flow, List Person Mail Messages, List Person Products, List Person Permitted Users, List Person Followers, Add Person Follower, Delete Person Follower, Upload Person Picture, Delete Person Picture
- **Pipelines**: List Pipelines, Create Pipeline, Get Pipeline, Update Pipeline, Delete Pipeline, Get Pipeline Deals, Get Pipeline Conversion Rates, Get Pipeline Movement Statistics
- **Product Fields**: List Product Fields, Create Product Field, Get Product Field, Update Product Field, Delete Product Field, Delete Product Fields
- **Products**: List Products, Create Product, Get Product, Update Product, Delete Product, Search Products, List Product Deals, List Product Files, List Product Followers, Add Product Follower, Delete Product Follower, List Product Permitted Users
- **Projects**: List projects, Create project, Get details of project, Update project, Delete project, Archive project, Returns project plan, Update activity in project plan, Update task in project plan, Returns project groups, Returns project tasks, Returns project activities, List project boards, Get project phases
- **Project Templates**: List Project Templates, Get Project Template, Get Project Board, Get Project Phase
- **Recents**: Get Recents
- **Roles**: List roles, Create role, Get one role, Update role details, Delete role, List role assignments, Create role assignment, Delete role assignment, List role settings, Create or update role setting, List pipeline visibility for role, Update pipeline visibility for role
- **Stages**: List Stages, Create Stage, Get Stage, Update Stage, Delete Stage, Delete Stages, List Stage Deals
- **Tasks**: List Tasks, Create Task, Get Task, Update Task, Delete Task
- **User Connections**: List User Connections
- **User Settings**: List User Settings
- **Users**: List Users, Create User, Get User, Update User, Find Users, Get Current User, List User Followers, List User Permissions, List User Role Assignments, List User Role Settings
- **Webhooks**: List Webhooks, Create Webhook, Delete Webhook

## Agent Ideas

- When a new opportunity arrives, use **Pipedrive** "Search Persons" to find or "Create Person", then "Create Deal" and notify the sales team with **Slack** "Send Message To Channel".
- Pull qualified rows from a tracker with **Google Sheets** "Get Rows", then call **Pipedrive** "Create Lead" or "Create Deal" for each to bulk-import them into the CRM.
- After **Pipedrive** "Update Deal" moves a deal to a won stage, use **Gmail** "Send Message" to send the customer an onboarding email enriched with deal details from "Get Deal".
