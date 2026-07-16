# UptimeRobot FlowRunner Extension

Monitor uptime and manage alerting with the [UptimeRobot API v2](https://uptimerobot.com/api/). Create and edit HTTP(S), Keyword, Ping, Port, and Heartbeat monitors; manage alert contacts, maintenance windows, and public status pages; and read account details for connection checks.

## Ideal Use Cases

- Programmatically create and configure monitors for new endpoints as they go live.
- Pause or resume monitors and adjust check intervals during planned changes.
- Manage alert contacts (e-mail, SMS, webhooks, integrations) and attach them to monitors.
- Schedule maintenance windows to suppress alerts during known downtime.
- Build and update shareable public status pages for selected monitors.

## List of Actions

- Get Monitors
- Create Monitor
- Edit Monitor
- Delete Monitor
- Reset Monitor
- Get Alert Contacts
- Create Alert Contact
- Delete Alert Contact
- Get Maintenance Windows
- Create Maintenance Window
- Delete Maintenance Window
- Get Public Status Pages
- Create Public Status Page
- Delete Public Status Page
- Get Account Details

## List of Triggers

This service has no triggers.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Your UptimeRobot **Main API Key**. Find it in UptimeRobot under **My Settings → API → Main API Key**. |

## Notes

- **All-POST, form-encoded model.** Every UptimeRobot v2 request is a `POST` with a form-encoded body that always includes `api_key` and `format=json`. This service handles that automatically; you only provide operation-specific fields.
- **Monitor types.** Supported types are HTTP(S), Keyword, Ping, Port, and Heartbeat. Keyword monitors require a keyword value (and optionally a keyword type: alert when the keyword *exists* or *does not exist*). Port monitors require a port number.
- **Monitor type is immutable.** A monitor's type cannot be changed after creation via **Edit Monitor** — delete and recreate to change it. Use the **Status** field on **Edit Monitor** to pause or resume a monitor.
- **Friendly labels.** Monitor type/status, keyword type, alert contact type, maintenance window recurrence, and status-page sort are selected as human-readable labels and mapped to the API's integer codes for you.
- **Selectable IDs.** Monitor and alert-contact ID fields are backed by searchable pickers (Get Monitors Dictionary and Get Alert Contacts Dictionary); you may also type an ID directly.
- **Rate limits.** UptimeRobot enforces per-plan rate limits (10 requests/minute on the Free plan). Errors returned with `stat: "fail"` are surfaced with the API's error message.

## Agent Ideas

- Use **UptimeRobot** "Create Monitor" whenever a new service is deployed, then **Slack** "Send Message To Channel" to post the monitor's status and share URL.
- On a schedule, run **UptimeRobot** "Get Monitors" filtered to the *Down* status and use **PagerDuty** "Create Incident" to page the on-call responder for each outage.
- Run **UptimeRobot** "Get Monitors" filtered to the *Down* status and use **Gmail** "Send Message" to escalate outages to a distribution list.
