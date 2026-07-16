# Strava FlowRunner Extension

FlowRunner integration for [Strava](https://www.strava.com), the social platform for athletes. Connects over OAuth2 to read athlete profiles and stats, manage activities, explore segments, browse clubs, and look up gear and routes via the Strava API v3.

## Ideal Use Cases

- Sync completed activities into a spreadsheet, dashboard, or training log
- Create or update manual activities (e.g. from a treadmill or non-GPS workout)
- Track weekly, year-to-date, and all-time totals plus personal bests via athlete stats
- Explore and star segments within a geographic area for route planning
- Monitor a club's activity feed and membership
- Report gear mileage to schedule maintenance or replacement

## List of Actions

### Athlete

- Get Athlete Stats
- Get Authenticated Athlete
- List Athlete Clubs
- List Athlete Zones
- Update Athlete

### Activities

- Create Activity
- Get Activity
- Get Activity Comments
- Get Activity Kudoers
- Get Activity Laps
- List Activities
- Update Activity

### Segments

- Explore Segments
- Get Segment
- Get Segment Efforts
- List Starred Segments

### Clubs

- Get Club
- Get Club Activities
- Get Club Members

### Gear

- Get Gear

### Routes

- Get Route
- List Athlete Routes

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses **OAuth2**. You must create a Strava API application to obtain credentials.

1. Sign in at [https://www.strava.com/settings/api](https://www.strava.com/settings/api) and create an application.
2. Copy the **Client ID** and **Client Secret** into the service configuration in FlowRunner.
3. Set the application's **Authorization Callback Domain** to match the redirect domain used by FlowRunner.
4. Connect an account in FlowRunner to complete the OAuth flow.

### Configuration

| Config Item    | Required | Description                       |
| -------------- | -------- | --------------------------------- |
| `clientId`     | Yes      | Strava application Client ID.     |
| `clientSecret` | Yes      | Strava application Client Secret. |

### Scopes

The connection requests the following scopes:

```
read,activity:read_all,activity:write,profile:read_all
```

- `read` — read public profile information.
- `activity:read_all` — read all activities, including private/hidden ones.
- `activity:write` — create and update activities.
- `profile:read_all` — read complete profile information, including heart rate and power zones.

### Refresh-token rotation

Strava rotates the refresh token on **every** successful refresh: the token endpoint returns a **new** `refresh_token` each time, and the previous one is invalidated. This service returns the new `refresh_token` from `refreshToken`, so FlowRunner persists it and the connection stays valid. No action is required on your part.

## Notes

- All distances are in **meters** and times in **seconds**, per the Strava API.
- Some endpoints (athlete stats, athlete routes) accept an athlete id but only return data for the **authenticated** athlete.
- Segment efforts require an active Strava subscription on the connected account.
- Write actions (Update Athlete, Create Activity, Update Activity) require the relevant `*:write` scope.

## Agent Ideas

- After a workout, call **Strava** "List Activities" to fetch the newest activity, then use **Google Sheets** "Add Row" to append its distance, time, and pace into a training log spreadsheet.
- Use **Strava** "Get Athlete Stats" to pull weekly and year-to-date totals, then use **Gmail** "Send Message" to email an athlete their progress summary.
- When **Strava** "Get Gear" shows a bike or pair of shoes has crossed a mileage threshold, use **Slack** "Send Message To Channel" to post a maintenance-due reminder.
