# Zoom FlowRunner Extension

FlowRunner integration for [Zoom](https://zoom.us) — create and manage meetings, register attendees, fetch invitation text, work with cloud recordings, and list past-meeting participants through the [Zoom REST API v2](https://developers.zoom.us/docs/api/) using OAuth2.

## Ideal Use Cases

- Auto-create scheduled or recurring Zoom meetings from form submissions, CRM deals, or calendar events, then share the join URL with attendees.
- Register attendees for a meeting and email each person their personal join link.
- Retrieve cloud recording download links after a meeting ends and archive them to storage or a spreadsheet.
- Pull past-meeting participant reports (join/leave times) for attendance tracking and follow-up.
- Fetch ready-to-send invitation text and post it to chat or email.

## List of Actions

### Meetings

- Create Meeting
- Delete Meeting
- Get Meeting
- Get Meeting Invitation
- List Meetings
- Update Meeting

### Registrants

- Add Meeting Registrant
- List Meeting Registrants

### Recordings

- Delete Meeting Recordings
- Get Meeting Recordings
- List Cloud Recordings

### Past Meetings

- List Past Meeting Participants

### Users

- Get My User

## List of Triggers

This service does not define any triggers. Zoom webhooks (event subscriptions) are configured at the app level in the Zoom Marketplace UI and are not creatable via the REST API per connected account. Use List Meetings / List Cloud Recordings in scheduled flows for polling-style automation.

## Zoom OAuth App Setup

1. Sign in at [marketplace.zoom.us](https://marketplace.zoom.us) and go to **Develop → Build App**.
2. Create a **General App** (user-managed OAuth). Legacy "OAuth" user-managed apps work the same way.
3. On the app's credentials page, copy the **Client ID** and **Client Secret** into this service's configuration.
4. Set the **OAuth Redirect URL** (and add it to the OAuth Allow List) to the callback URL FlowRunner shows when connecting the account.
5. Add the required **scopes** to the app. Zoom scopes are configured on the app itself — they are not passed in the authorization URL:
   - `meeting:read` / `meeting:write` — meetings, registrants, invitations
     (granular equivalents: `meeting:read:meeting`, `meeting:write:meeting`, `meeting:read:list_meetings`, `meeting:write:registrant`, `meeting:read:list_registrants`, `meeting:read:invitation`, `meeting:read:list_past_participants`)
   - `recording:read` / `recording:write` — cloud recordings
     (granular: `cloud_recording:read:list_user_recordings`, `cloud_recording:read:list_recording_files`, `cloud_recording:delete:meeting_recording`)
   - `user:read` — the connected user's profile (granular: `user:read:user`)
6. Connect the account in FlowRunner; the connection is identified by the Zoom account's email and profile picture.

## Configuration

| Item          | Required | Shared | Description                            |
| ------------- | -------- | ------ | -------------------------------------- |
| Client ID     | Yes      | Yes    | OAuth Client ID from your Zoom app     |
| Client Secret | Yes      | Yes    | OAuth Client Secret from your Zoom app |

## Notes & Limitations

- **Webinars are not included.** Zoom webinars require a separate paid add-on license, so webinar operations are intentionally out of scope for this service.
- Cloud recording features and past-meeting participant reports require a **paid Zoom plan** (Pro or higher); Zoom returns an error on free accounts.
- Adding a registrant requires the meeting to have registration enabled (configured when scheduling the meeting in the Zoom web portal).
- `next_page_token` pagination tokens expire after 15 minutes.
- Deleting a meeting or its recordings cannot be undone (recordings moved to trash are recoverable for 30 days in the Zoom web portal).

## Agent Ideas

- Use **Google Calendar** "On Event Starting Soon" to detect an upcoming appointment, then call **Zoom** "Create Meeting" and share the join URL back onto the calendar event.
- When **Fireflies.ai** "On New Transcript" fires, call **Zoom** "List Past Meeting Participants" to reconcile attendance, then **Google Sheets** "Add Row" to log who attended each meeting.
- After a meeting, use **Zoom** "Get Meeting Recordings" to fetch the download links, then **Gmail** "Send Message" to email the recording to attendees.
