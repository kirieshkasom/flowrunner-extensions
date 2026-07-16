# Azure Blob Storage FlowRunner Extension

Manage Azure Blob Storage containers and blobs — list, create, inspect, upload, download, copy, snapshot, and manage metadata — using zero-dependency, hand-rolled Shared Key (HMAC-SHA256) request signing.

## Ideal Use Cases

- Upload files into a container from inline text or by streaming from a public source URL
- Download a blob into FlowRunner file storage so downstream steps can attach, forward, or process it
- List containers and blobs (with prefix filtering and pagination) to drive dynamic flows
- Copy a blob server-side from another Azure blob or accessible URL
- Snapshot a blob to preserve a point-in-time version before modifying or deleting it
- Read and replace custom metadata on blobs to tag and organize objects

## List of Actions

- **Containers** — List Containers, Create Container, Get Container Properties, Delete Container, List Blobs
- **Blobs** — Upload Blob, Get Blob, Get Blob Properties, Delete Blob, Copy Blob, Set Blob Metadata, Get Blob Metadata, Snapshot Blob

## Dictionaries

- **Get Containers Dictionary** — lists containers for selection in dependent parameters (prefix search + pagination)

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

Requests are authorized with **Shared Key** authorization: every request is signed with an HMAC-SHA256 signature computed from the request line, canonicalized `x-ms-*` headers, and the canonicalized resource, using your account key (base64-decoded) as the HMAC key. The signature is sent as an `Authorization: SharedKey {accountName}:{signature}` header alongside `x-ms-date` and `x-ms-version: 2021-08-06`. The signing is **hand-rolled with Node's built-in `crypto` module** — the service has no external dependencies.

All requests target `https://{accountName}.blob.core.windows.net`.

| Config item | Required | Notes |
| --- | --- | --- |
| Account Name | Yes | Your Azure Storage account name, e.g. `mystorageacct`. |
| Account Key | Yes | Base64 account key from Azure Portal → Storage account → Security + networking → Access keys → key1. |

> **Security note:** the account key grants full access to the storage account. Store it securely and rotate it periodically.

## Notes & Behavior

- **Responses** — Azure Blob Storage returns operation results primarily in **response headers** (ETag, Last-Modified, copy status, snapshot id, metadata) and in **XML** bodies for list operations. XML is parsed with a small, zero-dependency tag extractor.
- **Upload from URL** — Upload Blob accepts a `Source URL`; the file at that URL is downloaded and streamed into the blob. Inline `Content` is used when no source URL is supplied.
- **Download to storage** — Get Blob downloads the blob's bytes and stores them in FlowRunner file storage, returning a URL. Requires file storage (declared via `@usesFileStorage`).
- **Metadata** — metadata is supplied and returned as plain name/value string pairs and is transmitted as `x-ms-meta-{name}` headers. Set Blob Metadata replaces all existing metadata.
- **Errors** — Azure error responses (403 authorization, 404 not found, 409 conflict, etc.) are parsed from the XML `<Error><Code>/<Message>` document (or the `x-ms-error-code` header for HEAD requests) and surfaced with the HTTP status code.
- **Smoke test** — because the Shared Key signing is hand-rolled, run a live smoke test (e.g. List Containers) after configuring credentials to confirm the signature is accepted before relying on it in production flows.

## Agent Ideas

- Use **Gmail** "Get Attachments" to pull an incoming email attachment, then call **Azure Blob Storage** "Upload Blob" to archive it into a container for long-term storage.
- When a **Dropbox** "On New File" trigger fires, use **Azure Blob Storage** "Upload Blob" with the file's source URL to mirror the new file into an Azure container.
- Use **Azure Blob Storage** "Get Blob" to download a stored report into FlowRunner file storage, then **Google Sheets** "Add Row" to log the file URL and metadata into a tracking spreadsheet.
