# Google Docs FlowRunner Extension

FlowRunner integration for [Google Docs](https://docs.google.com) — create, read, edit, export,
and generate documents from templates through the
[Google Docs API](https://developers.google.com/docs/api/reference/rest) and the
[Google Drive API](https://developers.google.com/drive/api/reference/rest/v3) using the connected
user's Google account (OAuth 2.0).

## Ideal Use Cases

- Generate contracts, invoices, offer letters, and reports from a template document by replacing
  `{{placeholder}}` tokens with workflow data (**Create From Template**).
- Read a document's full plain text for summarization, analysis, or AI processing
  (**Get Document** returns a convenience `text` field).
- Append meeting notes, logs, or AI-generated content to a running document.
- Export a finished document to PDF (or DOCX/HTML/plain text) and store it in FlowRunner file
  storage for emailing or archiving.
- Perform any advanced Docs API operation (styling, tables, images, headers) via the raw
  **Batch Update** escape hatch.

## List of Actions

### Documents

- Create Document
- Get Document
- Delete Document

### Text Editing

- Append Text
- Insert Text
- Replace All Text
- Batch Update

### Templates

- Create From Template

### Export

- Export Document

## List of Triggers

This service does not define any triggers.

## Authentication & Setup (Google Cloud Console)

This service uses OAuth 2.0 **user authentication**. You need a Google Cloud project with the
Docs and Drive APIs enabled and an OAuth client:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Enable the **Google Docs API**: APIs & Services > Library > "Google Docs API" > Enable.
3. Enable the **Google Drive API** (required for template copying, document listing, export, and
   deletion): APIs & Services > Library > "Google Drive API" > Enable.
4. Configure the **OAuth consent screen** (APIs & Services > OAuth consent screen) and add the
   scopes listed below. While the app is in "Testing" publishing status, add your users as test
   users; refresh tokens for testing apps expire after 7 days unless the app is published.
5. Create an **OAuth client ID** (APIs & Services > Credentials > Create Credentials >
   OAuth client ID, type "Web application") and add FlowRunner's OAuth redirect URI to the
   authorized redirect URIs.
6. Copy the **Client ID** and **Client Secret** into the service configuration in FlowRunner.

### Required OAuth scopes

- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

The Drive scope is required because template copying (`files.copy`), document listing
(`files.list`), export (`files.export`), and deletion (`files.delete`) go through the Google
Drive API.

## Configuration

| Item          | Description                                            | Shared |
| ------------- | ------------------------------------------------------ | ------ |
| Client Id     | OAuth 2.0 Client ID from the Google Cloud Console.     | Yes    |
| Client Secret | OAuth 2.0 Client Secret from the Google Cloud Console. | Yes    |

A **Get Documents Dictionary** provides dynamic document selection (label: document name,
value: document ID, note: last modified time) for all document parameters. Every document
parameter also accepts a bare document ID or a full Google Docs URL
(`https://docs.google.com/document/d/{id}/edit`).

## Template convention (Create From Template)

Placeholders in the template document use double curly braces, e.g. `{{name}}`,
`{{invoice_number}}`. The `Replacements` object maps bare keys to values:

```json
{ "name": "Acme Corp", "invoice_number": "INV-42" }
```

Each key `foo` replaces every occurrence of `{{foo}}` in the copied document (case-sensitive).
Keys already wrapped in `{{ }}` are matched literally as provided. The result includes an
occurrence count per placeholder so you can verify all tokens were filled.

## Important limitations

- **Export size**: the Drive export endpoint limits exported content to **10 MB**.
- **Delete is permanent**: **Delete Document** removes the file immediately, bypassing the
  trash — it cannot be recovered.
- **Insert Text indexes**: the Docs API uses character indexes into the document body (index 1
  is the start). Use the `body.content` structure returned by **Get Document**
  (`startIndex`/`endIndex` per element) to determine insertion points.
- **User-scoped access**: the service acts as the connected user and can only access documents
  that user can open in Google Drive (own drive and shared drives).

## Notes

- **Get Document** returns the raw Docs API document resource plus a `text` field containing the
  concatenated plain text of the body (paragraphs, tables, and table-of-contents content).
- All create/edit operations return a `documentUrl` field with a direct edit link.
- **Batch Update** accepts the raw
  [batchUpdate request format](https://developers.google.com/docs/api/reference/rest/v1/documents/batchUpdate)
  for operations not covered by dedicated actions (text styling, tables, images, named ranges,
  headers/footers, deletions).

## Agent Ideas

- Fetch a submission with **Google Forms** "Get Form Response by ID", use **Google Docs** "Create From Template" to generate a personalized welcome letter, then "Export Document" to PDF and email it via **Gmail** "Send Message".
- Use **Google Docs** "Get Document" to pull a meeting-notes document as plain text, summarize it with an AI action, and post the summary to **Google Chat** "Send Message" or **Slack** "Send Message To Channel".
- Read deal data with **HubSpot** "Get Deal By ID", generate a contract via **Google Docs** "Create From Template", and send the exported PDF for signature with **DocuSign** "Send Envelope with Document".
- Append daily workflow run summaries to a shared log document with **Google Docs** "Append Text", keeping a running audit trail the whole team can read.
