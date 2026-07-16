# PostHog FlowRunner Extension

Integrates [PostHog](https://posthog.com) product analytics with FlowRunner. Capture events, manage
persons and feature flags, run HogQL queries, and create annotations.

## Two key types

PostHog uses **two different kinds of keys**, and this service needs both for full functionality:

- **Personal API Key** (required) — authorizes the read/management REST API (persons, events,
  queries, insights, feature flags, cohorts, annotations). Sent as `Authorization: Bearer <key>`.
  Create one under **Settings → Personal API Keys**.
- **Project API Key** (optional, `phc_...`) — authorizes the public **ingestion/capture** API used
  by Capture Event, Identify User, and Create Alias. It is submitted inside the request body, not as
  a header. Find it under **Project Settings → Project API Key**. Ingestion operations fail with a
  clear error if this key is not configured.

## Ideal Use Cases

- Stream custom product events from any workflow into PostHog for analytics.
- Sync and enrich person profiles, then segment users with cohorts and feature flags.
- Run HogQL queries on demand to power reports, alerts, or downstream automations.
- Programmatically manage feature flags to gate rollouts from a workflow.
- Annotate charts automatically when releases or incidents occur.

## List of Actions

**Ingestion** (needs Project API Key)
- Capture Event
- Identify User
- Create Alias

**Persons**
- List Persons
- Get Person
- Update Person Properties
- Delete Person

**Events**
- List Events
- Get Event

**Insights**
- Run Query
- List Insights

**Feature Flags**
- List Feature Flags
- Get Feature Flag
- Create Feature Flag
- Update Feature Flag
- Delete Feature Flag

**Cohorts**
- List Cohorts
- Get Cohort

**Annotations**
- Create Annotation
- List Annotations

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Personal API Key | Yes | Reads data and performs management operations. |
| Project API Key | No | `phc_...` token needed only for event ingestion (Capture Event / Identify User / Create Alias). |
| Project ID | Yes | Numeric project ID from **Settings**, used in management API paths. |
| Host | No | PostHog host. Defaults to `https://us.i.posthog.com` (US Cloud). |

### US vs EU cloud

- **US Cloud:** `https://us.i.posthog.com` (default)
- **EU Cloud:** `https://eu.i.posthog.com`
- **Self-hosted:** your own instance URL

Set the **Host** config item to match the region where your PostHog project lives.

## Notes

- **Run Query** most commonly runs HogQL, PostHog's SQL dialect over the events and persons tables,
  e.g. `{"kind":"HogQLQuery","query":"SELECT event, count() FROM events GROUP BY event"}`; results
  come back as rows plus column definitions.
- Dictionaries **Get Feature Flags Dictionary** and **Get Insights Dictionary** power selectable
  flag/insight dropdowns (value = flag/insight ID).

## Agent Ideas

- Use **Segment** "Track Event" to log a conversion, then call **PostHog** "Capture Event" to mirror the same event for product analysis, and **PostHog** "Create Annotation" to mark the release on charts.
- When **PostHog** "Run Query" surfaces an anomaly in a HogQL result, use **Slack** "Send Message To Channel" to alert the team and **Google Sheets** "Add Row" to log the metric snapshot.
- Enrich a user with **PostHog** "Update Person Properties", check their eligibility via **PostHog** "Get Feature Flag", then send a targeted onboarding email with **Gmail** "Send Message".
