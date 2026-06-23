# Front Service — Inbound Attachment Support

**Date:** 2026-06-23
**Service:** `services/front-service`
**Status:** Approved design

## Goal

Add full support for *receiving* email attachments in the Front service:

1. The **On New Inbound Message** trigger (and **List Conversation Messages** action) should expose a clean, documented list of attachments for each message.
2. A new **Get Attachment** action downloads an attachment's binary content from Front, stores it in FlowRunner Files, and returns a URL to the stored file.

Outbound attachment support (uploading files when sending/replying) already exists and is unchanged.

## Background

Front message objects already include an `attachments` array. Each attachment from the Front API looks like:

```json
{
  "id": "fil_231iuypv",
  "filename": "invoice.pdf",
  "url": "https://<tenant>.api.frontapp.com/download/fil_231iuypv",
  "content_type": "application/pdf",
  "size": 84210,
  "metadata": { "is_inline": false }
}
```

The binary is downloaded via `GET https://api2.frontapp.com/download/{attachment_id}` (or the `url` field directly), authenticated with the same `Bearer` token the service already uses (`attachments:read` scope).

`onNewInboundMessage` ([services/front-service/src/index.js:1041](../../../services/front-service/src/index.js#L1041)) already spreads the raw `msg`, so `attachments` already flows through — but it is undocumented in the sample result and the per-attachment shape is not normalized.

## Changes

### 1. Normalize and document attachments on read paths

Add a small helper:

```js
function normalizeAttachment(att) {
  return {
    id: att.id,
    filename: att.filename,
    content_type: att.content_type,
    size: att.size,
    url: att.url,
    is_inline: att.metadata?.is_inline ?? false,
  }
}
```

- In `onNewInboundMessage`, map `msg.attachments` through `normalizeAttachment` when building each emitted event, so emitted inbound messages carry a clean `attachments` array (empty array when none).
- Update the `@sampleResult` of **On New Inbound Message** ([index.js:1039](../../../services/front-service/src/index.js#L1039)) to include an `attachments` array with one example entry.
- Update the `@sampleResult` of **List Conversation Messages** ([index.js:486](../../../services/front-service/src/index.js#L486)) to include an `attachments` array. (The raw Front message already contains `attachments`; this is a documentation/visibility change only — no transformation of the list response is required.)

No change to polling watermark/seen-id state logic.

### 2. New action: Get Attachment

JSDoc annotations:

- `@operationName Get Attachment`
- `@category Attachments`
- `@route POST /get-attachment`
- `@appearanceColor #A777E3 #C39FE9` (match existing conversation actions)
- `@executionTimeoutInSeconds 60`

Parameters:

- `attachment` (String, required) — an attachment `id` (`fil_...`) **or** a full download URL. If the value starts with `http`, it is validated and used as-is (see "URL validation" below); otherwise the URL is built as `${API_BASE_URL}/download/{attachment}`.
- `fileName` (String, optional) — name to store the file under. Falls back to the basename of the URL or `attachment`.
- `targetDirectory` (String, optional) — folder in FlowRunner Files. Defaults to `/front-attachments`.

URL validation (security):

The Front Bearer token is attached to the download request, so the request must only ever be sent to a Front host. When `attachment` is a full URL:

- Parse it with `new URL(value)`. Reject (throw) if parsing fails.
- Require `protocol === 'https:'`.
- Require the hostname to equal `frontapp.com` or end with `.frontapp.com` (case-insensitive). This covers both `api2.frontapp.com` and per-tenant `<tenant>.api.frontapp.com` download hosts.
- On any failure, throw a clear error (e.g. `Attachment URL must be a Front (frontapp.com) download link`) **before** issuing the request — never send the token to a non-Front host.

The bare-`id` path needs no validation: the service constructs the api2 URL itself.

Behavior:

1. Resolve the download URL from `attachment` (validating it per above when it is a URL).
2. Download the binary with the existing Bearer auth header, in binary mode: `Flowrunner.Request.get(url).set({ Authorization: 'Bearer ...' }).setEncoding(null).unwrapBody(false)` → `response.body` is a Buffer; `response.headers['content-type']` gives the MIME type.
3. Save via `Flowrunner.Files.saveFile(directory, name, buffer, true)` (the global-`Flowrunner` pattern this service uses; matches `box`/`dropbox`). This returns the stored file URL.

Returns:

```json
{ "url": "https://.../files/front-attachments/invoice.pdf" }
```

`@sampleResult {"url":"https://.../files/front-attachments/invoice.pdf"}`

### 3. Reuse

- Add a private binary-download helper (e.g. `#downloadBinary({ url, logTag })`) that applies the Bearer header and binary encoding, so download auth is not duplicated. Reuse the existing `this.apiKey` for the header.
- `normalizeAttachment` is a module-level helper (alongside `clean`/`splitCsv`) used by the trigger.

## Non-goals / trade-offs

- Uses `Flowrunner.Files.saveFile` (returns a URL string), not gmail's `this.flowrunner.Files.uploadFile` — this service uses the global `Flowrunner` runtime and has no `this.flowrunner` instance reference. Consistent with `box` and `dropbox`.
- No webhook/realtime trigger work; polling trigger fidelity is unchanged.
- Inline images are included in the attachment list (with `is_inline: true`) but no special handling is added.

## Testing

- Verify `npx eslint services/front-service --fix` passes.
- Manual verification in FlowRunner: trigger fires on an inbound email with an attachment → `attachments[]` populated → Get Attachment with one entry's `id` (and separately its `url`) → returns a FlowRunner Files URL that downloads the original file.
- Get Attachment rejects a non-Front URL (e.g. `https://evil.example.com/x`) with the validation error and does not issue the request.
- README updated via the `readme-maintainer` agent after implementation.
