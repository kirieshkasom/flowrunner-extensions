# Beeminder FlowRunner Extension

Connects FlowRunner to [Beeminder](https://www.beeminder.com/), the goal-tracking service that puts money on the line. Manage goals and their datapoints, refresh graphs, read your user profile, and issue charges through the Beeminder API v1. Authentication uses a personal auth token sent as the `auth_token` query parameter; the username defaults to `me`, resolving to the account that owns the token.

## Ideal Use Cases

- Log progress automatically to a Do More or Odometer goal whenever an activity happens in another app (a task completed, a commit pushed, a workout tracked).
- Keep a goal's datapoints in sync from a spreadsheet or database by batch-creating datapoints on a schedule.
- Use idempotent datapoint creation (via Request ID) so retried automations never create duplicate entries.
- Read a goal's safety buffer and urgency to alert yourself when it is about to derail.
- Programmatically create, update, or refresh goals as part of a habit-building workflow.

## List of Actions

### User
- Get User

### Goals
- List Goals
- Get Goal
- Create Goal
- Update Goal
- Refresh Goal Graph

### Datapoints
- List Datapoints
- Create Datapoint
- Create Datapoints Batch
- Update Datapoint
- Delete Datapoint

### Charges
- Charge User

## List of Triggers

This service does not define any triggers.

## Configuration

- **Auth Token** (required) — your personal Beeminder auth token, found in Beeminder → Settings → account → API/apps, or at `beeminder.com/api/v1/auth_token.json`.
- **Username** (optional) — your Beeminder username; defaults to `me`, which resolves to the account that owns the auth token.

## Notes

- **Idempotent datapoints:** When creating a datapoint, supply a Request ID to make the call safe to retry. Repeating a create with the same Request ID updates the existing datapoint instead of creating a duplicate.
- **Charge User moves real money** (USD, minimum $1.00). Use Dry Run to validate a charge without processing it.
- **Goal Type** offers friendly labels mapping to API values: Do More (hustler), Odometer (biker), Weight Loss (fatloser), Weight Gain (gainer), Whittle Down (inboxer), Do Less (drinker), Custom.
- Timestamps are Unix time in seconds; daystamps use `YYYYMMDD` and take precedence when both are supplied. Goal-slug parameters are backed by a dictionary that lists your goals.

## Agent Ideas

- When **Todoist** "Complete Task" fires, call **Beeminder** "Create Datapoint" (with a Request ID for safe retries) to log the completion against a Do More goal.
- On a schedule, use **Google Sheets** "Get Rows" to read tracked activity, then **Beeminder** "Create Datapoints Batch" to sync all entries onto a goal in one request.
- Use **Beeminder** "Get Goal" to read a goal's safety buffer and urgency, then **Slack** "Send Message To Channel" to alert a channel when the goal is about to derail.
