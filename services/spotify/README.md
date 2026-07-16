# Spotify FlowRunner Extension

Connect to a Spotify account via OAuth2 to search the Spotify catalog, read track/album/artist details, manage playlists and the "Liked Songs" library, and control playback on the user's devices. Track, album, and artist parameters accept a Spotify id, URI, or `open.spotify.com` URL interchangeably.

## Ideal Use Cases

- Automatically build or update playlists from tracks discovered by search or from external lists
- Sync a user's saved tracks or top artists/tracks into a spreadsheet, CRM, or reporting tool
- Look up catalog metadata (tracks, albums, artists, top tracks) to enrich other workflows
- Remotely control playback (play, pause, skip, set volume, transfer device) from an automation
- Notify a channel or log activity when tracks are added to a playlist or the library

## List of Actions

### Search

- Search

### Catalog

- Get Album
- Get Album Tracks
- Get Artist
- Get Artist Albums
- Get Artist Top Tracks
- Get Track

### Playlists

- Add Items to Playlist
- Create Playlist
- Get Current User Playlists
- Get Playlist
- Get Playlist Items
- Remove Items from Playlist
- Update Playlist Details

### Library

- Get Saved Tracks
- Remove Saved Tracks
- Save Tracks

### Player

- Get Currently Playing
- Get Playback State
- Pause Playback
- Set Volume
- Skip to Next
- Skip to Previous
- Start or Resume Playback
- Transfer Playback

### User

- Get Current User Profile
- Get User Top Items

## List of Triggers

This service does not define any triggers.

## Authentication

Uses OAuth2 (Authorization Code flow). Register an app in the Spotify Developer Dashboard to obtain a Client Id and Client Secret, add the FlowRunner callback URL to the app's Redirect URIs, then connect an account. The connection requests these scopes: `user-read-private`, `user-read-email`, `playlist-read-private`, `playlist-modify-public`, `playlist-modify-private`, `user-library-read`, `user-library-modify`, `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `user-top-read`.

## Notes

- Track, album, and artist parameters accept a Spotify id, URI (`spotify:track:...`), or `open.spotify.com` URL — they are normalized automatically.
- **Player actions require Spotify Premium** and an active device: Get Playback State, Get Currently Playing, Start or Resume Playback, Pause Playback, Skip to Next/Previous, Set Volume, and Transfer Playback. On free accounts these calls fail or return no active device.
- Some catalog endpoints require a `market` (country code); Get Artist Top Tracks requires one.
- Result limits are 1–50 per request (default 20); use `offset` to paginate.

## Agent Ideas

- Use **Spotify** "Search" to find tracks matching a theme, then call **Spotify** "Add Items to Playlist" to build a curated playlist and **Slack** "Send Message To Channel" to share it with a team channel.
- Use **Spotify** "Get User Top Items" to pull a user's top tracks or artists, then **Google Sheets** "Add Row" to log them into a listening-trends spreadsheet.
- When a workflow curates new music, use **Spotify** "Get Saved Tracks" to read the latest liked songs and **Discord** "Send Message" to post them to a community server.
