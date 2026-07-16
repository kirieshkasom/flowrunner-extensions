# Marketo FlowRunner Extension

Connect your flows to Adobe Marketo Engage: sync and look up leads, manage static-list membership, run and schedule smart campaigns, read the lead activity stream, work with custom object and CRM records, manage marketing assets (programs, emails, forms, landing pages, smart lists, snippets, folders, and My-Tokens), and run bulk import/export jobs. Authenticates with your Marketo REST credentials (Client ID, Client Secret, and instance Base URL, e.g. `https://123-ABC-456.mktorest.com`); the bearer token is fetched and refreshed automatically. Some action groups require subscription add-ons: the Asset API actions need a Marketing-Activities/Asset entitlement, and the CRM-object actions require CRM-sync (Named Accounts additionally needs the ABM add-on).

## Ideal Use Cases

- Push new contacts from forms, CRMs, or spreadsheets into Marketo as leads (create or update)
- Add or remove leads from static lists to drive nurture and segmentation
- Trigger or schedule a smart campaign for a set of leads, with optional My-Token overrides
- Read lead activities (form fills, clicks, opens) into a flow for routing or reporting
- Create, query, or delete custom object and CRM records (opportunities, companies, sales persons, named accounts)
- Author and manage marketing assets: clone programs, emails, forms, and landing pages, manage folders, My-Tokens, smart lists, and snippets, and approve/unapprove for go-live
- Merge duplicate leads, push leads into a program, submit a form on a lead's behalf, or associate an anonymous web session with a known lead
- Bulk-import a lead file and poll its status, or bulk-export leads/activities and pull the resulting file
- Fire a flow automatically when a lead is created, an activity occurs, a watched field changes, or a lead is deleted

## List of Actions

### Leads
- Sync Leads
- Get Lead by ID
- Get Leads
- Delete Leads
- Describe Lead Fields
- Merge Leads
- Push Lead
- Submit Form
- Associate Lead

### Lists
- Get Lists
- Get List by ID
- Get Leads by List
- Add Leads to List
- Remove Leads from List
- Member of List

### Campaigns
- Get Campaigns
- Get Campaign by ID
- Request Campaign
- Schedule Campaign

### Activities
- Get Activity Types
- Get Paging Token
- Get Lead Activities

### Custom Objects
- List Custom Object Types
- Describe Custom Object
- Query Custom Objects
- Sync Custom Objects
- Delete Custom Objects

### CRM Objects (entitlement-gated)
- Describe / Query / Sync / Delete Opportunities
- Describe / Query / Sync / Delete Opportunity Roles
- Describe / Query / Sync / Delete Companies
- Describe / Query / Sync / Delete Sales Persons
- Describe / Query / Sync / Delete Named Accounts (ABM add-on)

### Assets - Programs (entitlement-gated)
- Browse Programs
- Get Program by ID
- Create / Update / Clone / Delete Program
- Approve / Unapprove Email Program

### Assets - Folders & My-Tokens
- Browse Folders
- Get Folder by ID
- Create / Update / Delete Folder
- Get Tokens by Folder
- Create / Delete Token

### Assets - Emails
- Browse Emails
- Get Email by ID
- Get Email Content
- Create / Update / Clone / Delete Email
- Approve / Unapprove Email
- Send Sample Email

### Assets - Forms
- Browse Forms
- Get Form by ID
- Get Form Fields
- Create / Update / Clone / Delete Form
- Approve / Unapprove Form

### Assets - Landing Pages
- Browse Landing Pages
- Get Landing Page by ID
- Get Landing Page Content
- Create / Update / Clone / Delete Landing Page
- Approve / Unapprove Landing Page

### Assets - Smart Lists & Snippets
- Browse Smart Lists
- Get Smart List by ID
- Clone / Delete Smart List
- Get Snippet by ID
- Get Snippet Content
- Create / Update / Delete Snippet
- Update Snippet Content
- Approve Snippet Draft

### Bulk - Lead Import
- Import Leads
- Get Import Lead Status
- Get Import Lead Failures
- Get Import Lead Warnings

### Bulk - Lead Export
- Create Lead Export
- Enqueue Lead Export
- Get Lead Export Status
- Get Lead Export File
- Cancel Lead Export

### Bulk - Activity Export
- Create Activity Export
- Enqueue Activity Export
- Get Activity Export Status
- Get Activity Export File
- Cancel Activity Export

## List of Triggers

- On New Lead
- On New Activity
- On Lead Field Change
- On Deleted Lead

## Agent Ideas

- When a Marketo **"On New Lead"** trigger fires, use Slack **"Send Message To Channel"** to alert your sales team and add the lead to a follow-up list with Google Sheets **"Add Row"**.
- Use Google Sheets **"Get Rows"** to read a list of event registrants, then call Marketo **"Sync Leads"** and **"Add Leads to List"** to load them into a nurture program.
- When a Marketo **"On Lead Field Change"** trigger fires on a lead-score field, call Marketo **"Request Campaign"** to run a smart campaign, then post to Slack **"Send Message To Channel"** for the account owner.
- On a new Salesforce or HubSpot deal, use Marketo **"Sync Opportunities"** and **"Sync Companies"** to keep CRM-object records aligned for account-based scoring.
