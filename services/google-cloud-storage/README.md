# Google Cloud Storage FlowRunner Extension

FlowRunner integration for [Google Cloud Storage](https://cloud.google.com/storage) — Google's object storage service. Manage buckets and objects, move file data between Cloud Storage and FlowRunner file storage, and generate V4 signed URLs for time-limited sharing and direct uploads.

## Ideal Use Cases

- Archive files produced by a flow (reports, exports, generated media) into a Cloud Storage bucket for durable, long-term storage.
- Fetch objects from Cloud Storage into FlowRunner file storage so later steps can process, convert, or attach them.
- Generate time-limited V4 signed URLs to let customers or partners download (or upload) a single object without granting broader access.
- Provision buckets on demand and manage object lifecycle (copy, move/rename, delete) as part of an automated pipeline.
- Read and update object metadata (content type, cache control, custom key/value pairs) to keep served assets correctly configured.

## Authentication

The service authenticates with a **Google Cloud service account key** (JSON key file). Access tokens are obtained via a signed JWT (RS256) and cached for the token's lifetime.

### Creating a service account

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select your project.
2. Go to **IAM & Admin → Service Accounts** and click **Create Service Account**.
3. Give it a name (e.g. `flowrunner-gcs`) and click **Create and Continue**.
4. Grant a role:
   - **Storage Admin** (`roles/storage.admin`) — full access, including creating and deleting buckets.
   - **Storage Object Admin** (`roles/storage.objectAdmin`) — object read/write only; bucket create/delete operations will fail. Note that `List Buckets` and the bucket picker require `storage.buckets.list`, which this role does not include — grant **Storage Admin** or add a role with that permission if you want bucket listing.
5. Open the new service account → **Keys** tab → **Add Key → Create new key → JSON**, and download the key file.

### Configuration

| Config item | Required | Description |
| --- | --- | --- |
| Service Account Key (JSON) | Yes | Paste the **full contents** of the downloaded JSON key file. |
| Project ID | No | Google Cloud project that owns the buckets. Defaults to the `project_id` in the key file. |

## Operations

### Buckets

- **List Buckets** — list the project's buckets with optional name-prefix filtering and pagination.
- **Get Bucket** — read a bucket's metadata (location, storage class, versioning, labels).
- **Create Bucket** — create a bucket with a location and default storage class (Standard / Nearline / Coldline / Archive).
- **Delete Bucket** — permanently delete an empty bucket.

### Objects

- **List Objects** — list objects with prefix filtering, folder-style browsing via a delimiter, and pagination.
- **Get Object Metadata** — read an object's size, content type, checksums, cache control, and custom metadata.
- **Download Object** — download an object into FlowRunner file storage and return a URL for later flow steps.
- **Upload Object** — upload a file (from a FlowRunner file URL or any public URL) into a bucket; content type is inferred from the object name when not specified.
- **Delete Object** — permanently delete an object.
- **Copy Object** — server-side copy to another name and/or bucket (combine with Delete Object for move/rename).
- **Update Object Metadata** — change an object's content type, Cache-Control header, and custom key/value metadata.

### Signed URLs

- **Generate Signed URL** — create a V4 signed URL (signed locally with the service account's private key; no API call) that grants time-limited GET (download) or PUT (upload) access to a single object. Maximum expiration: 7 days (604800 seconds).

## Notes

- Upload and Download move the object's bytes through FlowRunner and are best suited for files up to a few hundred MB. Copy Object is server-side and fast at any size.
- Deleting buckets and objects is irreversible (unless object versioning is enabled on the bucket).
- The signing service account itself needs permission on an object for a signed URL to work when used.

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires, call **Google Cloud Storage** "Upload Object" (passing the Dropbox "Get Temporary Link" URL) to mirror incoming files into a Cloud Storage bucket for durable archival.
- Use **Google Cloud Storage** "Download Object" to pull a raw PDF into FlowRunner file storage, then run **PDF.co** "Parse Invoice with AI" to extract structured data from it.
- After an export step writes a report, use **Google Cloud Storage** "Upload Object" followed by "Generate Signed URL", then **Gmail** "Send Message" to email the recipient a time-limited download link.
- Use **Google Sheets** "Get Rows" to read a list of object names, then call **Google Cloud Storage** "Copy Object" or "Delete Object" to reorganize or clean up a bucket in bulk.
