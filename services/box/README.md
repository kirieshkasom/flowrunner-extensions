# Box FlowRunner Extension

Connect FlowRunner to [Box](https://www.box.com/) to manage cloud files and folders via OAuth2: upload, download, organize, version, comment, task, apply metadata, share, search, manage collaborators, recover from trash, and react to item events in real time.

## Ideal Use Cases

- Upload or download files between Box and FlowRunner file storage.
- Organize, version, comment on, and task content.
- Apply metadata and share via expiring, password-protected links.
- Manage collaborators and search content before acting on it.
- React to Box file, folder, and collaboration events in real time.

## List of Actions

- Add Collaboration
- Copy File
- Copy Folder
- Create Comment
- Create File Shared Link
- Create Folder
- Create Folder Shared Link
- Create Metadata Instance
- Create Task
- Delete Comment
- Delete File
- Delete File Version
- Delete Folder
- Delete Metadata Instance
- Delete Task
- Download File
- Get Collaboration
- Get Comment
- Get Current User
- Get File Info
- Get File Version
- Get Folder Info
- Get Metadata Instance
- Get Task
- List File Collaborations
- List File Comments
- List File Tasks
- List File Versions
- List Folder Collaborations
- List Folder Items
- List Metadata Instances
- List Trashed Items
- Move File
- Move Folder
- Permanently Delete File
- Permanently Delete Folder
- Promote File Version
- Remove Collaboration
- Remove Shared Link
- Restore File
- Restore Folder
- Search Content
- Update Collaboration
- Update Comment
- Update File
- Update Folder
- Update Task
- Upload File
- Upload Large File

## List of Triggers

- On Collaboration Event
- On File Event
- On Folder Event

## Agent Ideas

- When **Box** "On File Event" fires, use "Download File" and pass the URL to **PDF.co** "Parse Invoice with AI".
- Use **Box** "Search Content" to find a report, then **Gmail** "Send Message" to email its link.
- After **Box** "Upload File", log the file with **Google Sheets** "Add Row".
