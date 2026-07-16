# Philips Hue FlowRunner Extension

Control and read Philips Hue smart lighting through the **Hue Bridge CLIP v2 API**. This service talks
directly to a Hue Bridge on the local network — control lights, grouped lights, rooms, zones, and
scenes, and read devices and sensors (motion, temperature, ambient light level). Requests are
authenticated with a `hue-application-key` header sent to the bridge's local IP.

## Ideal Use Cases

- Turn lights on/off, dim, or set color and warmth automatically in response to events from other services
- Flash or color a room to signal alerts, notifications, or build/deploy status
- Recall stored scenes to set the mood for a room or zone in a single call
- Control every light in a room or zone together via grouped lights
- Read motion, temperature, and ambient light sensors to drive lighting or other automations
- Verify bridge connectivity and configuration before running lighting workflows

## List of Actions

### Lights
- Get Lights
- Get Light
- Set Light State

### Grouped Lights
- Get Grouped Lights
- Set Grouped Light

### Rooms & Zones
- Get Rooms
- Get Room
- Get Zones

### Scenes
- Get Scenes
- Activate Scene

### Devices & Sensors
- Get Devices
- Get Motion Sensors
- Get Temperature
- Get Light Level

### Bridge
- Get Bridge

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Bridge IP Address** | Yes | Your Hue Bridge IP address on the local network, e.g. `192.168.1.2`. |
| **Application Key** | Yes | Your Hue application key / username, sent as the `hue-application-key` header. |

### Getting your credentials

1. **Find the bridge IP.** Open the Hue app (Settings → My Hue System → the bridge → the "i" icon),
   check your router's DHCP client list, or query `https://discovery.meethue.com`.
2. **Create an application key.** Press the physical **link button** on top of the bridge, then within
   ~30 seconds `POST` to `https://{bridgeIp}/api` with body:

   ```json
   { "devicetype": "flowrunner#hue", "generateclientkey": true }
   ```

   The response contains a `username` — that value is your **Application Key**.

All requests are authenticated with the `hue-application-key: {applicationKey}` header. The base URL is
`https://{bridgeIp}/clip/v2`.

## Deployment consideration — self-signed TLS on the local network

The Hue Bridge serves the CLIP v2 API over **HTTPS using a self-signed certificate**, on the **local
network** only. This has two implications for deployment:

- **Network reachability:** the FlowRunner runtime that executes this service must be able to route to
  the bridge's private IP address. A cloud-hosted runtime with no path to the LAN will not be able to
  connect.
- **Certificate trust:** the runtime's HTTP client may need to accept the bridge's self-signed
  certificate (its CN is the bridge ID, not the IP). If your environment rejects untrusted
  certificates by default, the bridge must be reachable in a mode that tolerates the self-signed cert.

Use **Get Bridge** as a connection check to confirm the IP, key, and TLS reachability are all working.

## CLIP v2 resource model

In the CLIP v2 API every entity is a **resource** addressed by an `rid` (a UUID), with an `rtype`
(`light`, `grouped_light`, `room`, `zone`, `scene`, `device`, `motion`, `temperature`,
`light_level`, `bridge`, …). Responses use the envelope:

```json
{ "errors": [], "data": [ /* resources */ ] }
```

This service checks `errors[]` — if it is non-empty the operation is treated as failed and the joined
error descriptions are thrown — and otherwise returns the unwrapped `data` array. Rooms and zones do
not control lights directly; they reference a `grouped_light` **service** (in their `services` array)
that you control via **Set Grouped Light**.

## Setting light state

**Set Light State** and **Set Grouped Light** build the CLIP v2 body from only the fields you provide,
so you can change one property without disturbing the others:

| Field | CLIP v2 body | Range / notes |
| --- | --- | --- |
| **On** | `on.on` | `true` / `false` |
| **Brightness** | `dimming.brightness` | `0`–`100` (percent) |
| **Color X / Color Y** | `color.xy.x` / `color.xy.y` | CIE chromaticity `0.0`–`1.0`; supply both |
| **Color Temperature (mirek)** | `color_temperature.mirek` | `153` (cool ≈ 6500K) – `500` (warm ≈ 2000K) |
| **Transition Duration (ms)** | `dynamics.duration` | milliseconds, e.g. `400` |

For example, turning a light on at half brightness sends `{"on":{"on":true},"dimming":{"brightness":50}}`.
Setting **color** and **color temperature** in the same call is not recommended — the bridge applies the
last effective value. Use the **Get Lights** dictionary to pick a light by name when selecting a rid.

## Agent Ideas

- When **Home Assistant** "Get Entity State" reports a motion or presence entity as active, use **Philips Hue** "Set Grouped Light" to switch on and brighten the corresponding room's lights.
- After a **Google Calendar** "On Event Starting Soon" trigger fires for a focus block, use **Philips Hue** "Activate Scene" to recall a cool, bright work scene for the office room.
- Use **OpenWeatherMap** "Get Current Weather" to read cloud cover as daylight fades, then call **Philips Hue** "Set Light State" to warm and dim the living-room lights.
