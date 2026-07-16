# LINE FlowRunner Extension

Send and manage messages through the [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/) for a LINE Official Account. Push and reply to chats, multicast/broadcast/narrowcast, download media a user sent you, look up user and group profiles, check your message quota and usage, and inspect rich menus. Authenticates with your channel access token.

## Ideal Use Cases

- Send proactive notifications or campaign messages to a user, group, or chat room
- Reply to an incoming user message within a webhook flow using the one-time reply token
- Fan out an announcement to many users via multicast, broadcast, or narrowcast
- Download images, videos, audio, or files that users send to your Official Account
- Enrich workflows with user/group profile data and monitor monthly message quota usage

## List of Actions

### Messaging

- Push Message
- Reply Message
- Multicast Message
- Broadcast Message
- Narrowcast Message
- Get Message Content

### Profile

- Get Profile
- Get Group Member Profile
- Get Group Summary

### Insights

- Get Message Quota
- Get Message Consumption
- Get Sent Message Count

### Rich Menu

- List Rich Menus
- Get Rich Menu

### Account

- Get Bot Info

## List of Triggers

This service does not define any triggers.

## Configuration

| Config item | Required | Description |
| --- | --- | --- |
| **Channel Access Token** | Yes | A long-lived channel access token for your Messaging API channel. Get it from the [LINE Developers Console](https://developers.line.biz/console/) → your provider → your Messaging API channel → **Messaging API** tab → **Channel access token (long-lived)**. It is sent to LINE as `Authorization: Bearer <token>`. |

## Key Concepts

### Push vs. Reply (and where `replyToken` / IDs come from)

- **Push Message** sends proactively to a **user ID**, **group ID**, or **room ID** and consumes your monthly message quota.
- **Reply Message** answers a user's incoming message using a one-time **reply token**. The reply token is delivered inside an **incoming webhook event** (the `replyToken` field of a message/follow/postback event). It can only be used once and expires shortly after the event is received. Replies do **not** count against your monthly quota.

LINE never exposes phone numbers or display names as addressable IDs. User IDs (`U...`), group IDs (`C...`), room IDs (`R...`), reply tokens, and message IDs all originate from **webhook events** your Official Account receives. Configure your webhook endpoint in the LINE Developers Console and read these values from the event payload.

### Message objects

LINE messages are an **array of message objects** (max 5 per send). Every send operation accepts either:

- a simple **Message** text — automatically wrapped as `[{ "type": "text", "text": "..." }]`, or
- a raw **Messages** array of LINE message objects for rich content (image, video, audio, sticker, location, template, flex, etc.). When a non-empty Messages array is provided it takes precedence over the Message text.

Example rich Messages value:

```json
[
  { "type": "text", "text": "Here is your photo:" },
  { "type": "image", "originalContentUrl": "https://example.com/full.jpg", "previewImageUrl": "https://example.com/preview.jpg" }
]
```

### Get Message Content

When a user sends media (image, video, audio, or file), the webhook message event carries a `message.id`. Pass that ID to **Get Message Content** to download the binary from LINE's content server. The file is saved to FlowRunner file storage and a downloadable `url` is returned. Message content is only retrievable for a limited period after the message is received.

## Notes

- Requires an approved LINE Official Account with the Messaging API enabled.
- Multicast targets **user IDs only** (no group/room IDs); use Push Message for groups and rooms.
- Broadcast and narrowcast can consume a large share of your monthly quota — use with care.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires, use **LINE** "Push Message" to instantly notify a team member's LINE chat with the sender and subject.
- Use **LINE** "Get Message Content" to download an image a user sent, then generate a caption or edited variant with **AI Image Generator** "Generate Image" and send it back with **LINE** "Reply Message".
- On a **Google Sheets** "On New Row" trigger, use **LINE** "Multicast Message" to broadcast the new entry (such as an event update) to a curated list of user IDs.
