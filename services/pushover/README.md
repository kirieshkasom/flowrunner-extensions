# Pushover FlowRunner Extension

Send push notifications to phones, tablets, and desktops through [Pushover](https://pushover.net).
This service wraps the Pushover API so FlowRunner flows can deliver real-time alerts, validate
recipients, monitor emergency acknowledgements, and check account quotas.

## Ideal Use Cases

- Push critical system alerts to on-call staff using Emergency priority that retries until acknowledged.
- Deliver order, deployment, or job-completion updates to a team's devices in real time.
- Validate a recipient's user or group key and active devices before sending important messages.
- Monitor an application's monthly message quota and usage to stay under the sending cap.

## Authentication

Pushover uses two distinct credentials, and it is important not to confuse them:

- **Application API Token** — configured **once** on the service as the `appToken` config item.
  It identifies your Pushover *application* and is sent with every request. Create one at
  [pushover.net/apps/build](https://pushover.net/apps/build) and copy the API Token/Key shown on
  the application page.
- **User/Group Key** — supplied **per message** as an operation parameter, not as config. It
  identifies the *recipient* (a user or a delivery group). A single application typically sends to
  many different users, which is why the recipient key lives on the operation rather than the
  service configuration.

Pushover authenticates by including the token in the request body (for writes) or query string
(for reads) — there is no Authorization header.

## List of Actions

### Notifications

- Send Notification
- Validate User/Group

### Emergency

- Get Receipt
- Cancel Emergency Retry

### Account

- Get Sounds
- Get Limits

## List of Triggers

This service does not define any triggers.

## Priorities

Send Notification accepts a priority level:

| Label | Value | Behavior |
| --- | --- | --- |
| Lowest | -2 | No notification generated; badge only on iOS. |
| Low | -1 | Delivered quietly (no sound/vibration). |
| Normal | 0 | Default behavior with sound/vibration. |
| High | 1 | Bypasses the user's quiet hours and is highlighted. |
| Emergency | 2 | Repeats until the user acknowledges it. |

### Emergency priority (retry / expire)

When priority is **Emergency**, Pushover repeats the notification until the recipient acknowledges
it, and two extra fields are **required**:

- **Retry Interval** — seconds between repeated notifications. Minimum **30**.
- **Expire After** — seconds after which Pushover stops retrying if still unacknowledged. Maximum
  **10800** (3 hours).

Sending an Emergency notification returns a `receipt` id. Use **Get Receipt** to poll whether it
was acknowledged, and **Cancel Emergency Retry** to stop the repeats once the situation is handled.

## Sounds

Send Notification offers the built-in Pushover sounds (Pushover, Bike, Bugle, Cash Register,
Classical, Cosmic, Siren, Space Alarm, Vibrate Only, None, and more). Use **Get Sounds** to
discover any custom sounds uploaded to your application beyond the built-in set.

## Error handling

Pushover responds with `{ "status": 0, "errors": [...], "request": "..." }` on failure. This
service detects `status: 0` and surfaces the joined `errors` list in the thrown error message.

## Agent Ideas

- When a **PagerDuty** "Create Incident" is raised, use **Pushover** "Send Notification" with Emergency priority to alert the on-call engineer until they acknowledge, then poll **Pushover** "Get Receipt" to confirm the alert was seen.
- After a **Sentry** "List Issues" query surfaces new unresolved errors, use **Pushover** "Send Notification" with a supplementary URL linking straight to the Sentry issue.
- When a **Jenkins** "Trigger Build" job finishes, use **Pushover** "Send Notification" to push the build result and console link to the team's devices.
