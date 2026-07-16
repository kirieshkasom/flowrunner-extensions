# QuickChart FlowRunner Extension

Generate chart images, QR codes, barcodes, and word clouds with [QuickChart](https://quickchart.io) directly from FlowRunner. Charts use the standard [Chart.js](https://www.chartjs.org/) configuration model (`type`, `data`, `options`). QuickChart is **keyless by default** — every operation works on the free tier — with an optional API key for higher rate limits and no watermark.

## Ideal Use Cases

- Turn workflow data into embeddable bar, line, or pie charts for emails, Slack messages, and dashboards
- Get a compact hosted chart URL via a POST body when a Chart.js config is too large to fit in a URL
- Produce QR codes linking to orders, tickets, or profiles on demand
- Encode SKUs, tracking numbers, or IDs as scannable barcodes
- Visually summarize survey responses, reviews, or documents as word clouds

## List of Actions

### Charts

- Create Chart
- Create Word Cloud
- Get Chart Image URL

### Codes

- Create Barcode
- Create QR Code

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** — Optional QuickChart API key from [quickchart.io](https://quickchart.io) for higher rate limits and no watermark. Leave blank to use the free tier. When set, it is sent as the `key` field on POST requests and as the `key` query parameter on generated URLs.

## Notes

- **Chart config model** — charts are a standard Chart.js JSON object: `type` (`bar`, `line`, `pie`, `doughnut`, `radar`, `scatter`, `bubble`, `polarArea`, `radialGauge`, and more), `data` (`{ labels, datasets }`), and optional `options`.
- **POST-create vs. GET-url** — **Create Chart** POSTs the config in the request body (no URL length limit) and returns a compact, hosted short URL; free-tier short URLs expire after roughly 3 days, and a paid API key extends this. **Get Chart Image URL** JSON-encodes the entire config into the `c` query parameter and returns instantly with no network call, but very long or complex configs can exceed URL length limits — switch to Create Chart in that case.
- **Create QR Code**, **Create Barcode**, and **Create Word Cloud** likewise build direct GET image URLs with no network call, so they return instantly and render on demand when the URL is loaded. For very long payloads, POST to the relevant QuickChart endpoint directly.
- Output formats: charts support PNG, SVG, and WebP; QR codes and word clouds support PNG and SVG.

## Agent Ideas

- Use **QuickChart** "Create Chart" to render workflow metrics into a hosted image, then use **Slack** "Send Message To Channel" to post the chart URL into a reporting channel.
- Use **Google Sheets** "Get Rows" to pull a dataset, build a Chart.js config, and call **QuickChart** "Create Chart" to produce a shareable visualization of the sheet's data.
- Use **QuickChart** "Create QR Code" to encode an order or tracking link, then use **Gmail** "Send Message" to email the customer an embeddable QR image.
