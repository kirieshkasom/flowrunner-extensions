# GoTo Webinar FlowRunner Extension

Manage GoTo Webinar (formerly GoToWebinar) webinars, registrants, attendees, and past-session
analytics from FlowRunner. Schedule and update webinars, register attendees and hand them their
personal join URLs, and pull attendance, poll, question, and survey data for reporting.

Authentication is OAuth 2.0 against the GoTo (LogMeIn) identity service. At connect time the service
looks up the organizer's key (and, where available, the account key) from GoTo's SCIM
`identity/v1/Users/me` endpoint and stores them with the connection, so you never have to supply them
per action.

## Ideal Use Cases

- Automatically register leads or event sign-ups from a form, CRM, or spreadsheet as webinar
  registrants and send them their personal join URLs.
- Schedule and update webinars (single session, series, or sequence) as part of a marketing
  campaign workflow.
- After a webinar runs, pull attendance, poll, question, and survey data for post-event reporting.
- Sync registrants and attendees into a CRM or email platform to trigger nurture sequences.
- Run account-wide reporting across every organizer's webinars for leadership dashboards.

## Setup

### 1. Create a GoTo OAuth app

1. Sign in to the [GoTo Developer Center](https://developer.goto.com) and open **My Apps**.
2. Create a new app (an **OAuth Client**). Give it a name and add FlowRunner's OAuth redirect URL as
   an authorized **Redirect URI** (FlowRunner shows this URL when you connect the account).
3. After creating the app, copy its **Client ID** (Consumer Key) and **Client Secret**
   (Consumer Secret).

### 2. Configure the service in FlowRunner

Provide the two config values from your OAuth app:

| Config item     | Description                                            |
| --------------- | ----------------------------------------------------- |
| `Client ID`     | The Client ID (Consumer Key) of your GoTo OAuth app.  |
| `Client Secret` | The Client Secret (Consumer Secret) of your app.      |

### 3. Connect an account

Start the OAuth connection in FlowRunner and sign in with the GoTo account that owns (or organizes)
the webinars. During the callback the service exchanges the code for an access token and then calls
GoTo's SCIM `identity/v1/Users/me` endpoint to look up the organizer key and account key, storing
them with the connection. GoTo Webinar API paths are scoped to the organizer
(e.g. `/organizers/{organizerKey}/webinars/...`), so this key is required for every action — if it
could not be resolved, reconnect the account.

## How it works

GoTo's current OAuth token response returns only an access token, refresh token, and scope — it no
longer includes the `organizer_key` or `account_key` (these were removed in GoTo's New Token
Retrieval migration; the old `api.getgo.com/oauth/v2` token host was decommissioned on 2025-09-30).
The service therefore fetches the organizer and account keys from GoTo's SCIM
`identity/v1/Users/me` endpoint right after the token exchange and embeds them into the stored access
token (the platform's composite-token pattern, using a `::gtw::` delimiter) so they are available on
every call. The organizer key is required and the connection fails if it cannot be resolved; the
account key is best-effort (only some accounts expose it). Token refresh re-embeds the captured keys
automatically.

## Typical flow

1. **Get All Webinars** (or the webinar picker on any action) to find a webinar and its key. The
   from/to date range is required and may span at most one year.
2. **Create Webinar** to schedule a new one — supply a subject, one or more `{startTime, endTime}`
   session ranges, and an IANA time zone (e.g. `America/New_York`). Use type *Single Session*,
   *Series*, or *Sequence*.
3. **Create Registrant** to register someone; the result includes a personal **join URL** to send to
   the attendee. If the webinar requires approval, the registrant starts in `WAITING` status.
4. After a webinar has run, **Get All Sessions** to find a session key, then read **Get Attendees**,
   **Get Session Performance**, and the poll / question / survey actions for reporting.

## Operations

### Webinars

- **Get All Webinars** — list webinars for the organizer within a date range.
- **Get Webinar** — full details of one webinar.
- **Create Webinar** — schedule a new webinar (single session, series, or sequence).
- **Update Webinar** — change subject, description, times, time zone, or approval setting.
- **Cancel Webinar** — delete a webinar, optionally emailing registrants.

### Registrants

- **Get Registrants** — list everyone registered for a webinar.
- **Get Registrant** — details of one registrant, including their join URL.
- **Create Registrant** — register a person (returns their personal join URL).
- **Delete Registrant** — cancel a registration.

### Attendees

- **Get Attendees** — people who attended a specific past session.
- **Get Attendee** — one attendee's participation details for a session.

### Sessions

- **Get All Sessions** — past sessions of a webinar (each run).
- **Get Session Performance** — aggregate attendance and engagement metrics.
- **Get Session Polls** — poll questions and answers.
- **Get Session Questions** — attendee Q&A.
- **Get Session Surveys** — post-session survey responses.

### Account

- **Get Account Webinars** — all webinars across every organizer in the account within a date range
  (requires account-wide access on the connected account).

## Notes

- Attendee, performance, poll, question, and survey data only exist for **past** sessions — run
  **Get All Sessions** first to obtain a session key.
- Dates are ISO 8601 (e.g. `2024-05-01T15:00:00Z`). Date ranges may not exceed one year.
- Errors surface the GoTo API `description` and, where present, its `int_err_code`.
- This service does not define any triggers.

## Agent Ideas

- When a **HubSpot** "Create Contact" fires from a new lead, call **GoTo Webinar** "Create Registrant" to sign them up for the next webinar and email them their personal join URL.
- Use **Google Sheets** "Get Rows" to read a list of event sign-ups, then call **GoTo Webinar** "Create Registrant" for each row to bulk-register attendees.
- After a webinar runs, call **GoTo Webinar** "Get Attendees" and "Get Session Surveys", then use **Google Sheets** "Add Rows" to log attendance and survey feedback for reporting.
- Following a **GoTo Webinar** "Get Attendees" call, use **Mailchimp Marketing** "Add Or Update List Member" to add attendees to a follow-up nurture list.
