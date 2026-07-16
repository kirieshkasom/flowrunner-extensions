# OpenWeatherMap FlowRunner Extension

Access current weather, multi-day forecasts, air quality data, and geocoding from the [OpenWeatherMap](https://openweathermap.org/api) API, plus the One Call 3.0 API. Authentication uses your API key, sent as the `appid` query parameter on every request. Note: newly created keys take approximately 1–2 hours to activate. Locations can be specified flexibly by city name (`"London"` or `"London,GB"`), latitude/longitude, ZIP/postal code (`"90210,US"`), or numeric city ID.

## Ideal Use Cases

- Enrich records or messages with live temperature, wind, humidity, and conditions for a location.
- Trigger automations from a 5-day forecast (e.g. rain expected, temperature thresholds).
- Monitor air quality (AQI and pollutant levels) for health or environmental alerts.
- Convert place names, ZIP codes, or coordinates into standardized location data.
- Retrieve historical or near-future weather for a precise moment via One Call 3.0.

## List of Actions

### Weather

- Get Current Weather
- Get 5 Day / 3 Hour Forecast

### Air Quality

- Get Air Pollution
- Get Air Pollution Forecast
- Get Air Pollution History

### Geocoding

- Direct Geocoding
- Reverse Geocoding
- Zip Geocoding

### One Call 3.0

- One Call Current & Forecast
- One Call Timemachine

## List of Triggers

This service does not define any triggers.

## Notes

- **API Key** is the only config item (required). Find it under **API keys** in your OpenWeatherMap account.
- **Key activation delay:** brand-new keys take ~1–2 hours to activate; calls before activation return an authentication error (`cod` 401).
- **Units/language:** Weather and forecast actions accept a Units dropdown (Standard/Kelvin, Metric/Celsius, Imperial/Fahrenheit) and an optional two-letter language code.
- **Air Quality** actions require latitude/longitude coordinates — run a Geocoding action first if you only have a place name or ZIP.
- **One Call 3.0** actions use the `/data/3.0/onecall` endpoints and require the separate "One Call by Call" subscription; they are not covered by the free plan.

## Agent Ideas

- Use **OpenWeatherMap** "Direct Geocoding" to resolve a city name to coordinates, then "Get Air Pollution" to check the AQI and post an alert via **Slack** "Send Message To Channel" when air quality is poor.
- On a schedule, call **OpenWeatherMap** "Get 5 Day / 3 Hour Forecast" and log each reading with **Google Sheets** "Add Row" for trend analysis.
- Pair **NASA** "Get EPIC Natural" imagery with **OpenWeatherMap** "Get Current Weather" for a location to assemble a daily earth-and-weather digest delivered via **Slack** "Send Message To Channel".
