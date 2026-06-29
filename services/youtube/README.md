# YouTube FlowRunner Extension

Connects FlowRunner to the YouTube Data API and YouTube Analytics/Reporting APIs over OAuth2, letting you manage channels, videos, playlists, comments, captions, subscriptions, live streams, and pull analytics for the authenticated account.

## Ideal Use Cases

- Automate publishing: upload videos, set thumbnails, manage playlists, and update metadata as part of a content pipeline.
- Moderate and engage: monitor comment threads, reply, mark spam, and run live-chat moderation during streams.
- Report on performance: pull channel/video analytics, demographics, traffic-source, device, and geography reports into spreadsheets or dashboards.
- React to channel activity: trigger downstream workflows when a new video, comment, or subscriber appears.
- Operate live events: create and transition broadcasts, bind streams, insert cuepoints, and manage live chat.

## Authentication

OAuth2 (Google). Provide your Google Cloud OAuth 2.0 **Client Id** and **Client Secret** (both shared). Each connected account authorizes the relevant YouTube scopes.

## Configuration

- **Client Id** (shared, required) - OAuth 2.0 Client ID from the Google Cloud Console.
- **Client Secret** (shared, required) - OAuth 2.0 Client Secret from the Google Cloud Console.
- **Enable Revenue Analytics** (BOOL) - Requests the monetary analytics scope so revenue metrics are available; requires Google app verification and re-authentication.
- **Default Region** - ISO 3166-1 alpha-2 fallback country code (default `US`); per-call values override.
- **Default Language** - BCP-47 fallback language code (default `en`) used for captions, search relevance, video, and branding language.

## List of Actions

### Channel

- Get My Channel, Get Channel, Update Channel Branding, Restore Channel Branding, Summarize Channel, List Activities, Test Connection

### Videos

- Get Video, Get Video by URL, List My Videos, List Popular Videos, Get Latest Videos, Upload Video, Update Video, Delete Video, Rate Video, Get Video Rating, Set Video Thumbnail

### Playlists

- List Playlists, Get Playlist by URL, Create Playlist, Update Playlist, Delete Playlist, List Playlist Items, Add Video to Playlist, Update Playlist Item, Remove Playlist Item

### Search & Discovery

- Search Videos, Search Channels, Search Playlists

### Subscriptions

- List Subscriptions, Subscribe to Channel, Unsubscribe

### Comments & Moderation

- List Comment Threads, List Comment Replies, Post Top-Level Comment, Post Comment Reply, Update Comment, Delete Comment, Set Comment Moderation Status, Mark Comments as Spam, Report Video Abuse

### Captions

- List Captions, Download Caption, Upload Caption, Delete Caption

### Analytics

- Run Analytics Query, Get Channel Overview, Get Channel Time Series, Get Top Videos, Get Video Analytics, Get Demographics Report, Get Traffic Source Report, Get Device Report, Get Geography Report, List Analytics Groups, Create Analytics Group, Delete Analytics Group, List Analytics Group Items

### Reporting

- List Report Types, List Reporting Jobs, Create Reporting Job, Delete Reporting Job, List Reports, Get Report

### Live Streaming

- List Live Broadcasts, Create Live Broadcast, Update Live Broadcast, Delete Live Broadcast, Transition Broadcast, Bind Broadcast to Stream, Insert Cuepoint, List Live Streams, Create Live Stream, Update Live Stream, Delete Live Stream, List Live Chat Messages, Post Live Chat Message, Delete Live Chat Message, List Live Chat Moderators, Add Live Chat Moderator, Remove Live Chat Moderator, Ban User from Live Chat, Remove Live Chat Ban, List Super Chats

## List of Triggers

- On New Video on Channel (polling)
- On New Video on Channel (Realtime)
- On New Comment on Video (polling)
- On New Subscriber (polling)

## Agent Ideas

- When **YouTube** "On New Video on Channel" fires, use **YouTube** "Summarize Channel" plus **Notion** "Create Page" to log each upload with a channel summary into a content tracker.
- On a **YouTube** "On New Comment on Video" trigger, evaluate sentiment and call **Slack** "Send Message To Channel" to alert the community team, optionally replying via **YouTube** "Post Comment Reply".
- Pull performance with **YouTube** "Get Channel Time Series" and "Get Top Videos", then use **Google Sheets** "Add Row" to append the metrics into a weekly analytics report.
