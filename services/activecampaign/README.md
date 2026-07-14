# ActiveCampaign FlowRunner Extension

Connects FlowRunner to [ActiveCampaign](https://www.activecampaign.com) for email marketing, marketing automation, and CRM. Manage contacts, tags, lists, custom fields, deals, automations, campaigns, and notes, and react to account activity in real time. Built on the [ActiveCampaign v3 API](https://developers.activecampaign.com/reference).

## Ideal Use Cases

- Sync leads captured elsewhere into ActiveCampaign as contacts without creating duplicates
- Tag and segment contacts, then start them in automations based on external events
- Keep CRM deals up to date and move them through pipeline stages
- Subscribe or unsubscribe contacts on mailing lists and set custom field values
- Trigger downstream workflows the moment a contact, tag, deal, or campaign event occurs

## Authentication

API key based. Requests use the `Api-Token` header against `{API URL}/api/3`.

| Config Item | Required | Description |
| --- | --- | --- |
| API URL | Yes | Account API URL, e.g. `https://youraccount.api-us1.com` (Settings → Developer) |
| API Key | Yes | Account API key (Settings → Developer → Key) |

## List of Actions

### Automations
- Add Contact To Automation
- List Automations

### Campaigns
- List Campaigns

### Contacts
- Delete Contact
- Get Contact
- List Contacts
- Sync Contact
- Update Contact

### Custom Fields
- Create Field Value
- List Fields

### Deals
- Create Deal
- Get Deal
- List Deals
- List Pipelines
- List Stages
- Update Deal

### Lists
- List Lists
- Update List Status For Contact

### Notes
- Add Note To Contact

### Tags
- Add Tag To Contact
- Create Tag
- List Tags
- Remove Tag From Contact

## List of Triggers

- On ActiveCampaign Event — realtime (SINGLE_APP); fires on the chosen event: contact added, updated, tagged, untagged, or unsubscribed; deal added or updated; campaign email opened; or a tracked link clicked

## Agent Ideas

- When an **ActiveCampaign** "On ActiveCampaign Event" trigger fires for a new contact, use **Slack** "Send Message To Channel" to alert the sales team with the contact's email and name.
- Use **Google Sheets** "Get Rows" to read a list of leads, then call **ActiveCampaign** "Sync Contact" for each row to upsert them into ActiveCampaign without duplicates.
- When an **ActiveCampaign** "On ActiveCampaign Event" trigger fires for a won deal (Deal Updated), use **Gmail** "Send Message" to send the customer an onboarding welcome email.
