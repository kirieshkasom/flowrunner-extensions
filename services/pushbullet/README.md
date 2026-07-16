# Pushbullet FlowRunner Extension

Send notes, links, and files to your devices, share pushes with other people, manage devices, and send SMS through Pushbullet from FlowRunner. Authenticates with a Pushbullet access token sent as the `Access-Token` header.

## Ideal Use Cases

- Push instant note, link, or file notifications to your phones, browsers, and virtual devices when a workflow event occurs.
- Notify another person by email or broadcast to channel subscribers without needing their device details.
- Send SMS text messages through a connected phone as part of an alerting or reminder flow.
- Programmatically dismiss, list, or clean up push history, and manage the devices pushes are addressed to.

## Authentication

This service uses a Pushbullet **Access Token**, sent on every request as the `Access-Token` header.

1. Sign in at [pushbullet.com](https://www.pushbullet.com).
2. Go to **Settings → Account**.
3. Click **Create Access Token** and copy the value.
4. Paste it into the service's **Access Token** configuration field in FlowRunner.

Base URL: `https://api.pushbullet.com/v2`

## Targeting pushes

Push actions (Push Note, Push Link, Push File from URL) can be delivered to different destinations. Leave all targeting fields empty to push to **every device on your account**, or set **exactly one** of:

- **Device** — a single device (selected via the device picker, which maps to the device's `iden`).
- **Email** — another Pushbullet user by email address (invites them if they are not yet a user).
- **Channel Tag** — broadcasts to all subscribers of a channel you own.

Do not combine more than one targeting field on a single push.

## Push types

- **Note** — a title and message body.
- **Link** — a clickable URL with an optional title and body.
- **File** — a file delivered by URL. Provide the file's public URL, name, and MIME type.

### Uploading a local file

Pushing a hosted file only needs its URL. To push a file that is not yet online, use Pushbullet's three-step upload flow, then pass the returned URL to **Push File from URL**:

1. `POST /v2/upload-request` with `file_name` and `file_type` → returns `upload_url` and `file_url`.
2. Upload the file bytes to `upload_url` (multipart/form-data).
3. Call **Push File from URL** with the returned `file_url`, `file_name`, and `file_type`.

## List of Actions

### Pushes
- **Push Note** — send a text notification.
- **Push Link** — send a clickable link.
- **Push File from URL** — push a hosted file.
- **List Pushes** — list pushes with `modified_after`, `active`, `limit`, and `cursor` paging.
- **Get Push** — fetch a single push by iden.
- **Dismiss Push** — mark a push dismissed without deleting it.
- **Delete Push** — permanently delete one push.
- **Delete All Pushes** — permanently delete every push (irreversible).

### Devices
- **List Devices** — list all registered devices.
- **Create Device** — create a virtual device to use as a push target.
- **Delete Device** — remove a device.

### Chats
- **List Chats** — list conversations with other users.

### Account
- **Get User Info** — return the current user's profile and account limits; also a connection check.

### SMS
- **Send SMS** — send a text message through a connected phone that has SMS enabled (`has_sms` is `true`). Provide the sending device, one or more recipient numbers, and the message.

## List of Triggers

This service does not define any triggers.

## Notes

- The **Get Devices Dictionary** picker powers the device selectors on the push, SMS, and delete-device actions. Its option value is the device iden; the note shows the device type and whether it supports SMS.
- Pushbullet timestamps are Unix seconds and may include a fractional part.
- SMS requires the Pushbullet app installed on the sending phone with SMS sync enabled.

## Agent Ideas

- When a workflow needs to reach a person both on their devices and in chat, call **Pushbullet** "Push Note" to hit their Pushbullet apps and **Slack** "Send Message To Channel" to post the same alert to a team channel.
- On a **Slack** "On Channel Message" trigger matching an urgent keyword, use **Pushbullet** "Send SMS" to text an on-call phone through a connected device.
- When a **Gmail** "On New Email" trigger fires for a priority sender, use **Pushbullet** "Push Link" to push a clickable link to the message to all of your devices.
- Pair **Pushbullet** "Push Note" with **Pushover** "Send Notification" to fan an alert out across both push platforms for redundancy.
