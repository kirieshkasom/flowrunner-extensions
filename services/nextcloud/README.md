# Nextcloud FlowRunner Extension

Integrate [Nextcloud](https://nextcloud.com/) with FlowRunner to manage files, folders, shares, and users on your own Nextcloud server. The service talks to two Nextcloud APIs: the **WebDAV** file API for file operations and the **OCS** API for shares and user provisioning. It authenticates with HTTP Basic auth using your Nextcloud username and an app password.

## Ideal Use Cases

- Archiving flow-generated documents (invoices, reports, exports) into a Nextcloud folder for long-term storage.
- Pulling files out of Nextcloud into a flow for parsing, conversion, or forwarding to another service.
- Organizing storage programmatically by creating folders and moving, copying, or deleting files.
- Generating public share links (with optional password and expiration) to distribute files externally.
- Auditing or provisioning access by listing users and inspecting the authenticated account.

## List of Actions

### Files

- Upload File
- Download File
- List Folder
- Create Folder
- Move
- Copy
- Delete

### Shares

- Create Share
- List Shares
- Get Share
- Update Share
- Delete Share

### Users

- Get Current User
- Get User
- List Users

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses **HTTP Basic authentication** with a Nextcloud **app password** (not your login password). App passwords are scoped, revocable credentials and are the recommended way to authenticate automated clients.

| Config | Description |
| --- | --- |
| **Server URL** | Your Nextcloud base URL, e.g. `https://cloud.example.com` (no trailing slash). |
| **Username** | Your Nextcloud username. |
| **App Password** | Create in Nextcloud under **Settings → Security → Devices & sessions → Create new app password**. |

The service sends `Authorization: Basic base64("username:appPassword")` on every request. Use **Get Current User** as a quick connection check to confirm the URL and credentials are valid.

## Notes

### The two APIs

- **WebDAV** (`{serverUrl}/remote.php/dav/files/{username}/{path}`) — file and folder operations. Uses standard and WebDAV-specific HTTP verbs (`PUT`, `GET`, `DELETE`, `PROPFIND`, `MKCOL`, `MOVE`, `COPY`). Folder listings are returned as a WebDAV `multistatus` XML document, which this service parses natively (zero dependencies).
- **OCS** (`{serverUrl}/ocs/v2.php/...`) — shares and user provisioning. Every OCS request includes the mandatory `OCS-APIRequest: true` header and `format=json` query parameter. Responses are wrapped in an `{ ocs: { meta, data } }` envelope; the service checks `meta.statuscode` and returns the unwrapped `data`.

### Shares

- **Share types**: User (0), Group (1), Public Link (3), Email (4). Public links return a public URL and token, and accept an optional password and expiration.
- **Permissions** map to Nextcloud's bitmask: Read (1), Edit (3), Create Only (4), Read & Share (17), All Permissions (31).

### Users

- **Get User** and **List Users** require the authenticated account to have permission to view/list users (admin or group subadmin).

### References

- [Nextcloud WebDAV API](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/)
- [Nextcloud OCS Share API](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/OCS/ocs-share-api.html)

## Agent Ideas

- After a **Gmail** "On New Attachment" trigger fires, use **Nextcloud** "Upload File" to archive the attachment into a folder created with "Create Folder".
- Use **Nextcloud** "Create Share" to generate a password-protected public link, then post it with **Slack** "Send Message To Channel" for the team to review.
- Pull a document with **Nextcloud** "Download File", then log its details and share status into a knowledge base with **Notion** "Create Page".
