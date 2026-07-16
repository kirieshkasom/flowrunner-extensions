# GetResponse FlowRunner Extension

FlowRunner service for the [GetResponse](https://www.getresponse.com/) email marketing platform, built on the [GetResponse API v3](https://apidocs.getresponse.com/v3). Manage contacts, campaigns (lists), newsletters, autoresponders, tags, and custom fields. Authenticates with a GetResponse API key.

## Ideal Use Cases

- Add or update subscribers in a GetResponse campaign when new leads arrive from forms, stores, or CRMs
- Look up and search contacts to enrich records or check subscription status
- Automate list hygiene by creating tags and custom fields and applying them to contacts
- Create and send newsletter broadcasts and inspect autoresponder cycles as part of a broader marketing workflow

## List of Actions

### Contacts

- Create Contact
- Get Contact
- List Contacts
- Search Contacts
- Update Contact
- Delete Contact

### Campaigns (Lists)

- Create Campaign
- Get Campaign
- List Campaigns

### Newsletters

- Create Newsletter
- Get Newsletter
- List Newsletters

### Autoresponders

- Get Autoresponder
- List Autoresponders

### Tags

- Create Tag
- Delete Tag
- List Tags

### Custom Fields

- Create Custom Field
- List Custom Fields

### From Fields

- List From Fields

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses API-key authentication. Requests are sent with the header `X-Auth-Token: api-key <YOUR_API_KEY>`.

### Getting an API key

1. Log in to GetResponse.
2. Open **Menu → Integrations & API → API**.
3. Click **Generate API key**, name it, and copy the generated value.
4. Paste it into the service's **API Key** configuration item.

### Base URL

By default this service uses the standard base URL `https://api.getresponse.com/v3`.

> **MAX / Enterprise accounts** use a different, account-specific base URL (`https://api3.getresponse360.com/v3` or a custom domain). Those accounts are not supported by the default configuration; contact your GetResponse account manager for the correct endpoint.

## Configuration

| Config item | Type   | Required | Description                                               |
| ----------- | ------ | -------- | --------------------------------------------------------- |
| API Key     | String | Yes      | GetResponse API v3 key (Menu → Integrations & API → API). |

## Notes

- In GetResponse terminology a **campaign** is a subscriber **list**.
- Custom field values are supplied as objects of the shape `{"customFieldId":"<id>","value":["<value>"]}` — the `value` property is always an array of strings.
- Dependent-parameter dropdowns are powered by internal dictionaries (campaigns, tags, custom fields, from-fields); these are not standalone actions.
- Errors returned by the API expose `message`, `code`, and `context`, which are surfaced in the thrown error message for easier debugging.

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, use GetResponse "Create Contact" to add the buyer to a campaign, then "Create Tag" and apply it to segment purchasers for follow-up newsletters.
- Use **Typeform** "Get Form Responses" to pull new survey signups, then call GetResponse "Search Contacts" and "Update Contact" to sync answers into custom fields.
- Migrate or mirror audiences by fetching subscribers from **Mailchimp Marketing** and calling GetResponse "Create Contact" to add each one into a target campaign.
