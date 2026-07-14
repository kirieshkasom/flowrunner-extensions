# Home Assistant FlowRunner Extension

Connect FlowRunner to your [Home Assistant](https://www.home-assistant.io/) instance to read entity states, control devices, fire and inspect events, render Jinja2 templates, and query history and calendars through the Home Assistant [REST API](https://developers.home-assistant.io/docs/api/rest/). Authentication uses your instance URL and a long-lived Bearer access token.

## Ideal Use Cases

- Turn devices on or off and adjust settings (lights, switches, thermostats) by calling Home Assistant services from an automation.
- Read live sensor and entity states to drive conditional logic in a workflow.
- Fire custom events on the Home Assistant event bus to trigger automations from an external system.
- Render templates against live state to compute values or human-readable status messages.
- Retrieve state history, logbook entries, or the error log for reporting and diagnostics.
- List and read upcoming events from Home Assistant calendar entities.

## List of Actions

### Config & Info
- Get API Status
- Get Config
- Check Config

### States
- Get States
- Get Entity State
- Set State

### Services
- List Services
- Call Service

### Events
- List Events
- Fire Event

### History & Logbook
- Get History
- Get Logbook
- Get Error Log

### Templates
- Render Template

### Calendars
- List Calendars
- Get Calendar Events

## List of Triggers

This service does not define any triggers.

## Authentication

This service authenticates with a **long-lived access token** and your instance URL.

1. **Server URL** — the base URL of your Home Assistant instance, e.g. `https://myhome.duckdns.org:8123`. A trailing slash is stripped automatically; the service appends `/api`.
2. **Access Token** — in Home Assistant, open your **Profile**, scroll to **Long-Lived Access Tokens**, choose **Create Token**, and copy the value (shown only once). The token is sent as `Authorization: Bearer <token>` on every request.

Your instance must be reachable from FlowRunner (a public URL, reverse proxy, or Nabu Casa Cloud). Use **Get API Status** to confirm connectivity — it returns `{"message": "API running."}` when the URL and token are valid.

## The states / services model

Home Assistant represents everything as **entities** (e.g. `light.kitchen`, `sensor.outside_temperature`, `calendar.family`). Each entity has a `state` value and an `attributes` object.

- To **read** an entity, use **Get States** (all entities) or **Get Entity State** (one entity).
- **Set State** only updates Home Assistant's internal representation of an entity — it does **not** talk to the physical device.
- To actually **control** a device, use **Call Service**: pick a `domain` (e.g. `light`) and a `service` (e.g. `turn_on`), and pass a target plus parameters in **Service Data**, e.g. `{"entity_id": "light.kitchen", "brightness": 255}`. Use **List Services** to discover available domain/service pairs and their fields.

Parameters that expect an `entity_id` offer a searchable picker backed by your instance's live entity list, but you can always type an `entity_id` directly.

## Notes

- Timestamps use ISO 8601 (e.g. `2024-06-01T00:00:00+00:00`). **Get History** and **Get Logbook** default their start to one day before the request when omitted.
- **Get History** can return a large amount of data; filter by entity IDs whenever possible.
- On error, Home Assistant returns a `{"message": "..."}` body; the service surfaces that message along with the HTTP status.

## Agent Ideas

- Use Home Assistant **Get Entity State** to read a door or motion sensor and, when it changes, call **Slack** "Send Message To Channel" to alert a security channel with the current state.
- On a schedule, use Home Assistant **Get History** for temperature and energy sensors and record each reading with **Google Sheets** "Add Row" for long-term trend tracking.
- Have an AI Agent interpret a natural-language request, then use Home Assistant **Call Service** (e.g. domain `light`, service `turn_on`) to control devices and **Render Template** to report the resulting room status.
