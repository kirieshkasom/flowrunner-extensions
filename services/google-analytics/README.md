# Google Analytics FlowRunner Extension

FlowRunner integration for [Google Analytics 4 (GA4)](https://analytics.google.com) — run
standard and realtime reports, discover available dimensions and metrics, and list accounts and
properties through the
[Google Analytics Data API](https://developers.google.com/analytics/devguides/reporting/data/v1)
and [Admin API](https://developers.google.com/analytics/devguides/config/admin/v1) using the
connected user's Google account (OAuth 2.0, read-only).

> **GA4 only.** Universal Analytics (UA) was shut down and its APIs no longer return data. This
> service works exclusively with GA4 properties.

## Ideal Use Cases

- Pull traffic, engagement, or revenue numbers into scheduled digests (daily active users,
  sessions by country, top pages by views).
- Feed GA4 report rows into spreadsheets, databases, or BI tools from a workflow.
- Monitor realtime activity (active users in the last 30 minutes by page or country) and alert
  when thresholds are crossed.
- Let AI agents answer analytics questions by discovering available dimensions/metrics via
  Get Metadata and composing Run Report calls.
- Enumerate the accounts and GA4 properties a user has access to.

## List of Actions

### Reports

- Run Report
- Run Realtime Report
- Get Metadata

### Admin

- List Accounts
- List Properties

## List of Triggers

This service does not define any triggers.

## Report output format

Instead of GA4's raw header/index response, **Run Report** and **Run Realtime Report** return
plain row objects keyed by dimension and metric API names, with metric values converted to
numbers:

```json
{
  "rows": [
    { "country": "United States", "activeUsers": 1234, "sessions": 1580 },
    { "country": "Germany", "activeUsers": 456, "sessions": 610 }
  ],
  "totals": { "activeUsers": 1690, "sessions": 2190 },
  "rowCount": 54,
  "metadata": { "currencyCode": "USD", "timeZone": "America/Los_Angeles" }
}
```

- `totals` contains the overall totals for the requested metrics across all matching rows.
- `rowCount` is the total number of matching rows (may exceed the rows returned — paginate with
  `Limit`/`Offset`).

## Date ranges

`Start Date` / `End Date` on **Run Report** accept absolute dates (`YYYY-MM-DD`) or relative
values: `today`, `yesterday`, and `NdaysAgo` (e.g. `7daysAgo`, `30daysAgo`). The default range
is `7daysAgo` → `today`.

## Authentication & Setup (Google Cloud Console)

This service uses OAuth 2.0 **user authentication** with read-only access. You need a Google
Cloud project with the Analytics APIs enabled and an OAuth client:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Enable the **Google Analytics Data API** and the **Google Analytics Admin API**:
   APIs & Services > Library > search each API > Enable.
3. Configure the **OAuth consent screen** (APIs & Services > OAuth consent screen) and add the
   scopes listed below. While the app is in "Testing" publishing status, add your users as test
   users; refresh tokens for testing apps expire after 7 days unless the app is published.
4. Create an **OAuth client ID** (APIs & Services > Credentials > Create Credentials >
   OAuth client ID, type "Web application") and add FlowRunner's OAuth redirect URI to the
   authorized redirect URIs.
5. Copy the **Client ID** and **Client Secret** into the service configuration in FlowRunner.

### Required OAuth scopes

- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

## Configuration

| Item          | Description                                            | Shared |
| ------------- | ------------------------------------------------------ | ------ |
| Client Id     | OAuth 2.0 Client ID from the Google Cloud Console.     | Yes    |
| Client Secret | OAuth 2.0 Client Secret from the Google Cloud Console. | Yes    |

Dictionaries provide dynamic selection throughout the service:

- **Get Properties Dictionary** — GA4 properties (label: display name, value: numeric property
  ID), built from account summaries. Used by all report operations.
- **Get Accounts Dictionary** — Google Analytics accounts, used by List Properties.
- **Get Dimensions Dictionary** / **Get Metrics Dictionary** — dimension/metric API names from
  the selected property's metadata (including custom dimensions/metrics), used by Run Report.

## Important limitations

- **Read-only**: the service uses the `analytics.readonly` scope; it cannot modify properties,
  data streams, or settings.
- **Realtime reports** cover roughly the last 30 minutes and support only a limited subset of
  dimensions (e.g. `country`, `deviceCategory`, `unifiedScreenName`, `eventName`) and metrics
  (e.g. `activeUsers`, `screenPageViews`, `eventCount`, `keyEvents`).
- Per-request limits: up to 9 dimensions and 10 metrics; up to 250,000 rows (API default
  10,000). GA4 properties are also subject to Data API token quotas.
- Standard reports may briefly return partially processed data for the most recent 24-48 hours.

## Notes

- Property and account parameters accept either the bare numeric ID (`123456789`) or the full
  resource name (`properties/123456789`, `accounts/100200300`).
- `Dimension Filter` is a raw GA4
  [FilterExpression](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/FilterExpression)
  passed through as-is; `Order Bys` accepts a single
  [OrderBy](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/OrderBy)
  object or an array of them.
- Use **Get Metadata** (or pass property `0` for the common set) to discover every dimension
  and metric available for a property, including custom ones.

## Agent Ideas

- On a daily schedule, use **Google Analytics** "Run Report" for yesterday's sessions and
  revenue by channel, then use **Google Sheets** "Add Row" to append the totals to a dashboard.
- Use **Google Analytics** "Run Realtime Report" every few minutes and send a **Slack** message
  when active users spike above a threshold.
- When a marketing campaign launches, use **Google Analytics** "Run Report" filtered by
  `sessionSource` and post a summary card with **Google Chat** "Send Message".
- Let an AI agent call **Google Analytics** "Get Metadata" to discover available fields, then
  compose ad-hoc "Run Report" queries to answer natural-language analytics questions.
