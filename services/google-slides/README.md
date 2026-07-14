# Google Slides FlowRunner Extension

FlowRunner integration for [Google Slides](https://slides.google.com) — create and manage
presentations, add and fill slides, run template-based document generation, and export slides to
PDF/PPTX or thumbnail images through the
[Google Slides API](https://developers.google.com/workspace/slides/api/reference/rest) and the
[Google Drive API](https://developers.google.com/workspace/drive/api/reference/rest/v3) using the
connected user's Google account (OAuth 2.0).

## Ideal Use Cases

- Generate customer-ready decks from a template presentation by filling `{{placeholder}}` tokens
  with workflow data (Create From Template).
- Build presentations programmatically: create a deck, add slides with predefined layouts, and
  insert text boxes at precise positions.
- Personalize existing decks by replacing text or swapping placeholder shapes with images
  (logos, charts, product photos) from a URL.
- Export finished presentations to PDF or PowerPoint and store them in FlowRunner file storage
  for emailing, archiving, or further processing.
- Render slide thumbnails as hosted PNG images for previews, approvals, or reports.
- Apply any advanced Slides API operation (styling, tables, duplication, speaker notes) via the
  raw Batch Update passthrough.

## List of Actions

### Presentations

- Create Presentation
- Get Presentation
- Create From Template
- Export Presentation
- Delete Presentation

### Slides

- Add Slide
- Delete Slide
- Get Slide Thumbnail

### Content

- Insert Text Box
- Replace All Text
- Replace Text With Image

### Advanced

- Batch Update

## List of Triggers

This service does not define any triggers.

## Authentication & Setup (Google Cloud Console)

This service uses OAuth 2.0 **user authentication**. You need a Google Cloud project with the
Slides and Drive APIs enabled and an OAuth client:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Enable the **Google Slides API** and the **Google Drive API**: APIs & Services > Library >
   search for each API > Enable. (The Drive API is required for listing, copying, exporting, and
   deleting presentations.)
3. Configure the **OAuth consent screen** (APIs & Services > OAuth consent screen) and add the
   scopes listed below. While the app is in "Testing" publishing status, add your users as test
   users; refresh tokens for testing apps expire after 7 days unless the app is published.
4. Create an **OAuth client ID** (APIs & Services > Credentials > Create Credentials > OAuth
   client ID, type "Web application") and add FlowRunner's OAuth callback URL as an authorized
   redirect URI.
5. Copy the **Client ID** and **Client Secret** into the service configuration in FlowRunner.

### Required OAuth Scopes

- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

## Configuration

| Name           | Required | Description                                             |
| -------------- | -------- | ------------------------------------------------------- |
| Client Id      | Yes      | OAuth 2.0 Client ID from the Google Cloud Console.      |
| Client Secret  | Yes      | OAuth 2.0 Client Secret from the Google Cloud Console.  |

## Notes & Limits

- **Template convention**: Create From Template replaces `{{placeholder}}` tokens. Replacement
  keys may be given with or without the surrounding braces; matching is case-sensitive.
- **Positions and sizes** for Insert Text Box are in points (PT). A default 10-inch-wide slide is
  720 PT wide by 405 PT tall.
- **Export limit**: Drive export supports at most 10 MB of exported content per file.
- **Image replacement**: image URLs must be publicly accessible, at most 50 MB, at most 25
  megapixels, and in PNG, JPEG, or GIF format.
- **File storage**: Export Presentation and Get Slide Thumbnail save their output to FlowRunner
  file storage and return a hosted URL. The storage scope (FLOW, WORKSPACE, or EXECUTION) is
  selectable per call.
- **Thumbnails** count as an expensive read request against the Slides API quota.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull per-customer data, call **Google Slides** "Create From Template" to generate a personalized deck for each row, then use **Gmail** "Send Message" to email the resulting edit link.
- After **Google Slides** "Export Presentation" produces a hosted PDF, use **Google Drive** "Upload File" to archive it into a shared folder and **Slack** "Send Message To Channel" to notify the team it is ready for review.
- When **Gmail** "On New Email" delivers a request with content to present, use **Google Slides** "Create Presentation" and "Insert Text Box" to build a starter deck, then "Get Slide Thumbnail" to attach a preview image back into a **Slack** "Send Message To Channel" approval message.
