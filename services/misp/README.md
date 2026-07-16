# MISP FlowRunner Extension

FlowRunner extension for [MISP](https://www.misp-project.org/) (Malware Information Sharing Platform), the open-source threat intelligence platform. Create and manage threat events, attach indicators of compromise (IOCs), tag and publish events, record sightings, and search your instance via the MISP REST API.

## Ideal Use Cases

- Automatically create a MISP event and attach IOCs (IPs, domains, hashes, URLs) whenever a new threat is detected upstream.
- Enrich or hunt across your instance by searching events and attributes for a specific indicator value.
- Classify and share events by applying TLP or other tags, then publishing to your community.
- Record sightings when an indicator is observed in your environment to track its prevalence.
- Keep an external system in sync with your threat intel by listing and retrieving events on a schedule.

## List of Actions

### Events
- Get Event
- Add Event
- Update Event
- Delete Event
- Publish Event
- Search Events
- List Events

### Attributes
- Add Attribute
- Get Attribute
- Edit Attribute
- Delete Attribute
- Search Attributes

### Tags
- List Tags
- Add Tag to Event
- Remove Tag from Event

### Sightings
- Add Sighting

## List of Triggers

This service does not define any triggers.

## Configuration

This service connects to your own MISP instance. Provide two configuration values:

- **Instance URL** — the base URL of your MISP instance, e.g. `https://misp.example.com` (strip any trailing slash).
- **API Key** — a MISP auth key. Find it in MISP under **Administration → List Auth Keys**, or from your profile under **Auth key**.

MISP expects the auth key in the `Authorization` header **as-is, with no `Bearer` prefix**.

## Notes

- **Data model** — *Events* group related threat indicators (each has a summary, distribution level, threat level, and analysis stage; events are created unpublished until published). *Attributes* are the individual IOCs attached to an event. *Tags* classify events (e.g. TLP) for filtering and sharing. *Sightings* record that an indicator was observed.
- **Search** — Search Events and Search Attributes use the MISP **restSearch** API; results are unwrapped into a plain array for you.
- **Enum values** — friendly dropdowns map to the integers MISP expects: *Distribution* (Your organisation only, This community only, Connected communities, All communities); *Threat Level* (High, Medium, Low, Undefined); *Analysis* (Initial, Ongoing, Completed).
- **Errors** — MISP errors are surfaced with their message, HTTP status, and any field-level errors in a single thrown error.

## Agent Ideas

- When a **urlscan.io** "Scan and Wait" verdict flags a malicious URL, call **MISP** "Add Event" then "Add Attribute" to record the URL and related IOCs as a new threat event.
- Use **MISP** "Search Attributes" to check whether an observed indicator is already known, and if not, promote it into **TheHive** via "Create Alert" for analyst triage.
- When a **MISP** "Publish Event" completes, use **Slack** "Send Message To Channel" to notify the security team with the event summary and threat level.
