# SIGNL4 FlowRunner Extension

Send and resolve SIGNL4 alerts ("signls") that reach your on-call team via push, SMS, and voice notifications. Authentication uses your team-secret inbound webhook (the last path segment of `https://connect.signl4.com/webhook/SECRET`), configured as the Team Secret — there is no separate API key or auth header.

## Ideal Use Cases

- Raise a mobile alert to the on-call team the moment a monitor, job, or webhook detects a failure
- De-duplicate and track incidents by reusing one stable External ID per incident across raise and close
- Automatically close an alert and stop escalation once an upstream system reports the incident recovered
- Enrich alerts with service, location, and source-system context for faster routing and triage

## List of Actions

### Alerting

- Resolve Alert
- Send Alert

## List of Triggers

This service does not define any triggers.

## Configuration

- **Team Secret** (required): Your SIGNL4 team secret, found in the SIGNL4 app or portal under **Integrations / Team**. It is the last path segment of your inbound webhook URL (the `SECRET` in `https://connect.signl4.com/webhook/SECRET`). It acts as the credential for all requests, so keep it private.

## Notes

- **Send Alert** and **Resolve Alert** are tied together by the External ID (`X-S4-ExternalID`). Set a stable, incident-specific External ID when raising an alert, then pass the exact same value to Resolve Alert to close it. Internally Send Alert posts with `X-S4-Status: "new"` and Resolve Alert with `X-S4-Status: "resolved"`, stopping further escalation. Reusing one External ID per incident also lets SIGNL4 de-duplicate repeated Send Alert calls.
- **Send Alert** supports acknowledgement modes: Single ACK (first responder acknowledges for the whole team) or Multi ACK (every notified person must acknowledge). Defaults to Single ACK.

## Agent Ideas

- When a **PagerDuty** "On New Triggered Incident" trigger fires, use **SIGNL4** "Send Alert" to page the mobile on-call team with the incident's ID as the External ID, then call **SIGNL4** "Resolve Alert" once PagerDuty "Resolve Alert" closes the incident.
- After a **SIGNL4** "Send Alert" raises an on-call alert, use **Slack** "Send Message To Channel" to post the incident title and External ID to the team's channel for shared visibility.
- Use **Sentry** "List Issues" to detect newly unresolved production errors, then call **SIGNL4** "Send Alert" (reusing the Sentry issue ID as the External ID) to escalate to the on-call team.
