# Affinity FlowRunner Extension

Connect FlowRunner to [Affinity](https://www.affinity.co/), the relationship intelligence CRM, to manage lists, people, organizations, opportunities (deals), custom fields, field values, and notes — and to react to Affinity events in real time.

## Authentication

Affinity uses an API key over **HTTP Basic authentication** with an **empty username** and the API key as the **password** — i.e. the request sends `Authorization: Basic base64(':' + apiKey)`. Generate a key in Affinity under **Settings → API → generate an API key** and paste it into the service's **API Key** configuration item.

## Data Model Notes

- **Lists** are saved views (of people, organizations, or opportunities). Each list defines **fields** (columns).
- A **List Entry** is a single row on a list — a person, organization, or opportunity attached to that list. Deleting a list entry detaches the entity from the list; it does not delete the entity itself.
- **Fields** and **Field Values** are separate: `Get Fields` returns field *definitions* (id, name, value type); `Get Field Values` returns the *stored values* for a given person, organization, opportunity, or list entry. Use a field value's `id` to update or delete it.
- Field value shapes depend on the field's value type (text, number, dropdown option id, ISO date, or a person/organization id).

## Ideal Use Cases

- Add people, organizations, and opportunities to Affinity lists and keep their custom fields up to date.
- Search people and organizations by name, email, or domain before acting on them.
- Log notes against contacts and deals from your automated workflows.
- Validate the API key connection and read plan/rate-limit context via `Get Current User`.
- React to Affinity events (new people, deal updates, list-entry changes, field-value edits, notes) in real time.

## List of Actions

- Create Field Value
- Create List Entry
- Create Note
- Create Opportunity
- Create Organization
- Create Person
- Delete Field Value
- Delete List Entry
- Delete Opportunity
- Delete Organization
- Delete Person
- Get Current User
- Get Field Values
- Get Fields
- Get Interactions
- Get List
- Get List Entries
- Get Lists
- Get Notes
- Get Opportunities
- Get Opportunity
- Get Organization
- Get Organizations
- Get Person
- Get Persons
- Search Organizations
- Search Persons
- Update Field Value
- Update Opportunity
- Update Organization
- Update Person

## List of Triggers

- On Affinity Event

## Agent Ideas

- When **Affinity** "On Affinity Event" fires for `opportunity.updated`, notify a channel with **Slack** "Send Message To Channel".
- Use **Affinity** "Search Persons" to look up a contact, then "Create Note" to log an interaction.
- After a new signup in another system, use **Affinity** "Create Person" and "Create List Entry" to add them to a pipeline list.
