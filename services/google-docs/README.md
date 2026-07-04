# Google Docs FlowRunner Extension

Complete Google Docs automation via OAuth2 — create, read, edit, format, and structure documents, then share, export, and comment on them. Content is read and written through the Docs API, files are located and organized (list, search, duplicate, move, trash) through Drive, and exports are saved to FlowRunner file storage. Polling triggers react to new and modified documents, revisions, and comments.

## Ideal Use Cases

- Generating documents from templates, Markdown, HTML, or DOCX sources and populating them with dynamic data
- Merging data into named ranges or replacing placeholder text to produce contracts, reports, and letters
- Programmatically editing and formatting content — inserting text, applying named styles, building tables, and placing images
- Exporting documents as PDF, DOCX, or Markdown and passing the download URL to downstream steps
- Monitoring a Drive for new or modified documents, revisions, and comments to trigger review and approval workflows
- Managing document sharing, permissions, and collaborative comment threads
- Extracting document text, outlines, or statistics for search, analysis, or AI summarization

## List of Actions

### Setup
- Test Connection

### Documents
- Get Document (Full Detail)
- Get Document Metadata
- Get Document As Plain Text
- Get Document As Markdown
- Get Document As HTML
- Get Document Outline
- Get Document Statistics
- Get Inline Images
- Get Named Ranges
- List Documents
- Search Documents By Content
- List Recent Documents
- List Documents Shared With Me
- List Documents In Folder
- Create Blank Document
- Create Document From Template
- Create Document From Markdown
- Create Document From HTML
- Create Document From DOCX URL
- Duplicate Document
- Rename Document
- Move Document To Folder
- Trash Document
- Restore Document From Trash
- Delete Document Permanently

### Text
- Insert Text At Index
- Append Text To Document
- Prepend Text To Document
- Delete Content Range
- Replace All Text
- Replace Multiple Texts
- Replace Text In Named Range
- Move Text
- Append Paragraph

### Formatting
- Format Text
- Set Text Link
- Clear Text Formatting
- Apply Named Style To Paragraph
- Set Paragraph Alignment
- Set Line Spacing
- Set Paragraph Indent
- Set Paragraph Spacing
- Set Paragraph Direction
- Apply Bullets
- Apply Numbered List
- Remove Bullets

### Tables
- Insert Table
- Insert Table Row
- Insert Table Column
- Delete Table Row
- Delete Table Column
- Set Table Cell Text
- Set Table Cell Style
- Set Table Column Width
- Set Table Row Height
- Merge Table Cells
- Unmerge Table Cells
- Pin Table Header Rows

### Images
- Insert Inline Image
- Append Inline Image
- Replace Image
- Delete Positioned Object

### Structure
- Insert Page Break
- Insert Section Break
- Create Header
- Create Footer
- Delete Header
- Delete Footer
- Set Header Or Footer Text
- Create Footnote
- Create Named Range
- Delete Named Range
- Update Section Style
- Update Document Style
- Set Document Background Color
- Set Page Orientation

### Tabs
- List Tabs
- Create Tab
- Rename / Reorder Tab
- Delete Tab

### Smart Inserts
- Insert Person Mention
- Insert Rich Link
- Insert Date

### Export
- Export Document
- Export As PDF
- Export As DOCX
- Export As Markdown
- List Document Revisions
- Export Document Revision

### Sharing
- Share Document
- List Document Permissions
- Remove Document Permission

### Comments
- List Comments
- Create Comment
- Reply To Comment
- Resolve Comment
- Delete Comment

## List of Triggers

- On Document Modified
- On Document Revision
- On New Comment
- On New Document

## Authentication

This service uses **OAuth2**. Connect a Google account from the connection settings before using any action. The connection grants the Google Docs and Drive scopes needed to read, edit, organize, and export documents.

## Configuration

- **Client ID** (required) — OAuth 2.0 Client ID from Google Cloud Console (APIs & Services > Credentials).
- **Client Secret** (required) — OAuth 2.0 Client Secret from Google Cloud Console (APIs & Services > Credentials).
- **Default Folder** (optional) — Drive folder ID used as the default destination when creating documents without an explicit folder. Leave blank to use My Drive root.
- **Include Tabs Content By Default** (optional, default `true`) — When enabled, Get Document reads all tabs; disable for legacy single-tab behavior. Multi-tab documents need this on to see content beyond the first tab.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull recipient data, then for each row call **Google Docs** "Create Document From Template" to generate a personalized letter, **Google Docs** "Export As PDF" to render it, and **Gmail** "Send Message" to email the PDF.
- When a **Google Docs** "On New Comment" trigger fires, use **Google Docs** "Get Document Metadata" to identify the document and **Slack** "Send Message To Channel" to alert the reviewers with a link.
- When a **Google Docs** "On Document Modified" trigger fires, use **Google Docs** "Get Document As Markdown" to read the latest content, **Gemini AI** "Generate Content" to summarize the changes, and **Google Docs** "Create Comment" to post the summary back onto the document.
