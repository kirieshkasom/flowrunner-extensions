# Oura FlowRunner Extension

Reads sleep, readiness, activity, biometric, and account data from a user's Oura Ring via the [Oura API v2](https://cloud.ouraring.com/v2/docs). Authenticates with an Oura Personal Access Token (PAT) sent as an `Authorization: Bearer` header. Most endpoints query by calendar date range under the `usercollection` namespace; results are paginated via `next_token`.

## Ideal Use Cases

- Sync daily readiness, sleep, and activity scores into a spreadsheet or dashboard for long-term trend tracking.
- Send a morning notification with the day's readiness score and sleep summary.
- Correlate workouts and sessions logged in Oura with training data from other fitness platforms.
- Flag low-readiness or high-stress days to adjust workload or recovery plans.
- Verify a connected account and pull personal info or ring configuration.

## List of Actions

### Daily Summaries

- Get Daily Readiness
- Get Daily Sleep
- Get Daily Activity
- Get Daily SpO2
- Get Daily Stress
- Get Daily Resilience
- Get Daily Cardiovascular Age

### Sleep Detail

- Get Sleep Periods

### Time Series

- Get Heart Rate

### Activity

- Get Workouts
- Get Sessions
- Get Enhanced Tags
- Get Rest Mode Periods

### Account

- Get Ring Configuration
- Get Personal Info

### Documents

- Get Single Document

## List of Triggers

This service does not define any triggers.

## Authentication

Uses a **Personal Access Token (PAT)** sent as `Authorization: Bearer {accessToken}`. To create one, sign in at [cloud.ouraring.com](https://cloud.ouraring.com), open **Personal Access Tokens**, create a token, and copy it into the service's **Access Token** configuration field. A PAT grants read access to the account that created it. To confirm the connection, run **Get Personal Info**.

## Notes

- **Date vs. datetime filtering.** Daily/summary endpoints filter by calendar date with `start_date`/`end_date` (`YYYY-MM-DD`): every operation except Get Heart Rate. **Get Heart Rate** is the exception — it filters by ISO 8601 datetime with `start_datetime`/`end_datetime` (e.g. `2024-01-15T00:00:00+00:00`). Passing a bare date to Heart Rate, or a full timestamp to a daily endpoint, is rejected by the API.
- **No date range.** Get Ring Configuration and Get Personal Info take no range. Get Personal Info returns a single object and is the simplest connection check.
- **Get Single Document.** Fetches one record by ID from a chosen **Collection** (dropdown) plus a **Document ID** (the `id` value from that collection's list operation).
- **Pagination.** List operations return `{ "data": [ ... ], "next_token": "..." }`. When `next_token` is non-null, pass it into the operation's **Next Token** parameter to fetch the next page.
- **Errors.** Oura returns `{ "detail": ... }`; the service surfaces the detail text with the HTTP status — 401 (invalid/missing token), 422 (validation error, e.g. malformed date/datetime), 426 (client must upgrade API version).

## Agent Ideas

- Use Oura **Get Daily Readiness** each morning, then **Slack** "Send Message To Channel" to post the readiness score and recovery status to a personal or team channel.
- Pull Oura **Get Daily Sleep** and **Get Daily Activity**, then **Google Sheets** "Add Row" to append each day's scores into a long-term health-tracking spreadsheet.
- Combine Oura **Get Workouts** with **Strava** "List Activities" to reconcile ring-detected workouts against logged training sessions, then **Google Sheets** "Add Rows" to store the merged dataset.
