# Microsoft OneDrive FlowRunner Extension

FlowRunner integration for [Microsoft OneDrive](https://www.microsoft.com/en-us/microsoft-365/onedrive/online-cloud-storage)
built on the [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/api/resources/onedrive) (v1.0).
It lets flows browse, search, download, and upload files in the connected user's OneDrive, manage folders,
move/rename/copy/delete items, create sharing links, and inspect the drive's storage quota — all on behalf
of the connected user (delegated permissions).

## Ideal Use Cases

- Archive generated reports, invoices, or exports from any workflow into OneDrive
- Pull documents out of OneDrive into FlowRunner file storage for AI processing, parsing, or delivery
- Organize incoming files automatically — create dated folders, move and rename items
- Produce shareable view or edit links for files and send them by email or chat
- Mirror files between OneDrive and other storage services (Dropbox, Google Drive, S3)
- Watch storage usage via the drive quota and alert before it runs out

## List of Actions

### Items

- List Items In Folder
- Search Items
- Get Item
- Move Item
- Rename Item
- Copy Item
- Delete Item

### Files

- Download File — saves the OneDrive file into FlowRunner file storage and returns its URL
- Upload File — from a FlowRunner file or external URL; files over 4 MB are transferred automatically
  through a resumable Graph upload session in 5 MB chunks

### Folders

- Create Folder

### Sharing

- Create Sharing Link

### Drive

- Get Drive Info

Dynamic dropdowns are provided for folders and drive items (root listing plus drive-wide search).

## List of Triggers

This service does not define any triggers. Microsoft Graph change notifications (webhooks for created or
modified drive items) require a publicly reachable notification URL that answers Graph's synchronous
`validationToken` handshake at subscription time, plus periodic subscription renewal. This is planned as
future work.

## Authentication

The service uses OAuth2 (authorization code flow) against the Microsoft identity platform
(`login.microsoftonline.com/common`), so both work/school accounts and personal Microsoft accounts can
connect (subject to your app registration's supported account types).

### Azure App Registration Setup

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) (or Azure Portal → Microsoft
   Entra ID).
2. Go to **App registrations** → **New registration**.
3. Give the app a name (e.g. `FlowRunner OneDrive Integration`).
4. Under **Supported account types**, choose **Accounts in any organizational directory and personal
   Microsoft accounts** (required for the `/common` endpoint used by this service).
5. Under **Redirect URI**, select platform **Web** and enter the OAuth callback URL provided by FlowRunner
   when configuring this integration.
6. Register the app and copy the **Application (client) ID** — this is the `Client ID` config item.
7. Go to **Certificates & secrets** → **New client secret**, create a secret, and copy its **Value** — this
   is the `Client Secret` config item.
8. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** and add:
   - `offline_access`
   - `User.Read`
   - `Files.ReadWrite.All`

## Configuration

| Config Item   | Required | Description                                                     |
| ------------- | -------- | --------------------------------------------------------------- |
| Client ID     | Yes      | Application (client) ID of the Microsoft Entra app registration |
| Client Secret | Yes      | Client secret value of the Microsoft Entra app registration     |

## Notes and Limitations

- All operations run against the connected user's own drive (`/me/drive`) with delegated permissions.
- Download File and Upload File hold the whole file in memory during transfer, so the practical size limit
  is the memory available to the function — keep files under a few hundred megabytes.
- Copy Item is asynchronous on the Microsoft Graph side: the action returns an accepted status immediately
  and the copy completes in the background, usually within seconds.
- Anonymous sharing links may be disabled by an organization's sharing policy; the Organization link scope
  is not available on personal OneDrive accounts.
- List and search results are paginated; pass the returned `nextLink` back via the `Next Page Link`
  parameter to fetch the next page.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires with an attachment, use **Microsoft OneDrive** "Upload File"
  to archive it into a dated folder created with "Create Folder".
- Use **Microsoft OneDrive** "Search Items" and "Download File" to pull a contract into FlowRunner storage,
  run it through an AI extraction step, and write the results to **Google Sheets**.
- After generating a report file in a flow, call **Microsoft OneDrive** "Upload File" and then
  "Create Sharing Link" (View, Anonymous) and post the link to a channel with **Microsoft Teams**
  "Send Channel Message".
