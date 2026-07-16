# NASA FlowRunner Extension

Access NASA's open APIs for astronomy imagery, Mars rover photos, near-Earth object tracking, full-disc Earth imagery, Landsat satellite imagery, space-weather events, and the NASA Image and Video Library. Authentication uses a single `api.nasa.gov` API key passed as the `api_key` query parameter; it defaults to `DEMO_KEY` (rate-limited) so you can try the service without signing up.

## Ideal Use Cases

- Post NASA's Astronomy Picture of the Day to a channel or newsletter on a schedule
- Monitor near-Earth asteroids and alert when a potentially hazardous object approaches
- Track solar flares, geomagnetic storms, and CMEs for space-weather dashboards
- Collect Mars rover photos or EPIC full-Earth imagery for research and content pipelines
- Search NASA's media library for images, video, or audio matching a topic

## List of Actions

### Astronomy Picture of the Day

- Get APOD

### Mars Rover Photos

- Get Latest Photos
- Get Mars Rover Photos
- Get Rover Manifest

### Asteroids NeoWs

- Browse Asteroids
- Get Asteroids Feed
- Lookup Asteroid

### EPIC Earth Imagery

- Get EPIC Enhanced
- Get EPIC Natural

### Earth

- Get Earth Assets
- Get Earth Imagery

### DONKI Space Weather

- Get CMEs
- Get Geomagnetic Storms
- Get Solar Flares

### Image Library

- Search NASA Images

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** — Your `api.nasa.gov` key, sent as the `api_key` query parameter. Defaults to `DEMO_KEY` for light testing (low, shared rate limits: ~30 req/hour, 50/day); get a free key at https://api.nasa.gov for real workloads. Not shared. **Search NASA Images** uses the separate `images-api.nasa.gov` endpoint and requires no key.

## Agent Ideas

- Fetch the daily image with **Get APOD**, then use **Slack** "Send Message To Channel" to post the title, explanation, and image URL to a team or community channel each morning.
- Pull upcoming close approaches with **Get Asteroids Feed** and log each object's name, size, miss distance, and hazard flag into a spreadsheet via **Google Sheets** "Add Rows" for ongoing tracking.
- Retrieve recent **Get Solar Flares** or **Get CMEs** events, then alert an operations channel with **Slack** "Send Message To Channel" whenever a significant space-weather event is detected.
- Search NASA's media library with **Search NASA Images**, then archive the returned assets into a shared drive using **Google Drive** "Upload File".
