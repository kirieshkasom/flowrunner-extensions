# Pushcut FlowRunner Extension

Send rich mobile notifications, run Shortcuts and HomeKit scenes, and manage webhook subscriptions using the [Pushcut Web API](https://www.pushcut.io/webapi). Pushcut turns your iPhone, iPad, and Apple Watch into programmable notification and automation endpoints.

## Ideal Use Cases

- Send a predefined, actionable notification to your devices from any workflow, with an overridden title, text, image, sound, and action buttons.
- Trigger a Shortcut, activate a HomeKit scene, or run a Pushcut automation on a device (optionally after a delay).
- Fan out server-side webhooks: subscribe an external URL to a Pushcut action so it fires whenever that action runs.
- Confirm connectivity and discover device and notification names for use in other steps.

## List of Actions

### Notifications

- Send Notification
- List Notifications

### Execute

- Execute Action

### Devices

- List Devices

### Subscriptions

- Add Subscription
- List Subscriptions
- Remove Subscription

## List of Triggers

This service has no triggers.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Your Pushcut API key, sent as the `API-Key` header. Get it in the Pushcut app under Account → API key (Integrations). |

## Notes

- Authentication uses the `API-Key` header on every request; the base URL is `https://api.pushcut.io/v1`.
- **Send Notification** requires the name of a notification you have already defined in the Pushcut app (Notifications tab). The action triggers that predefined notification and can override its title, text, image, sound, action buttons, target devices, and more at send time. Use **List Notifications** (or the built-in picker) to find valid names.
- **Execute Action** runs exactly one of a Shortcut, a HomeKit scene, or a Pushcut automation. Use the `Delay` field (e.g. `10s`, `5m`, `1h`) with an `Identifier` to schedule and later overwrite or cancel a delayed execution.
- The **Devices** field on Send Notification and Execute Action takes device names; leave it empty to target all your devices. Use **List Devices** to discover names.
- Subscriptions are server-side webhooks: **Add Subscription** ties a Pushcut action name to a URL that is called whenever the action runs, and **Remove Subscription** deletes it by id.

## Agent Ideas

- After a long-running workflow finishes, use **Pushcut** "Send Notification" to alert your phone with a time-sensitive notification and a tap action that opens the result.
- Combine a monitoring trigger with **Pushcut** "Execute Action" to activate a HomeKit scene (e.g. turn on lights) when an event occurs.
- Use **Pushcut** "Add Subscription" to have a Pushcut button call a FlowRunner webhook, wiring a physical/tap action into an automated workflow.
