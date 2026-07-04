'use strict'

const DOCS_API_BASE_URL = 'https://docs.googleapis.com/v1'
const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

const DEFAULT_PAGE_SIZE = 50
const MAX_DICTIONARY_PAGE_SIZE = 50
const MAX_LIST_PAGE_SIZE = 1000

// Docs uses Drive API to find/list/copy/move/export docs. Activity used for change-feed triggers.
//
// Scope notes:
//   - documents             — full read/write to Docs (RESTRICTED — needs app verification for prod)
//   - drive.file            — narrowly-scoped Drive access (only files this app touches). NOT enough
//                             for listing pre-existing docs. We pair it with the broader drive scope.
//   - drive                 — full Drive read/write (RESTRICTED — needs verification + CASA assessment)
//   - drive.readonly        — read-only Drive (RESTRICTED)
//
// We use `documents` + `drive` for full coverage; this matches the Google Drive extension's stance.
const SCOPE_GROUPS = {
  docs: ['https://www.googleapis.com/auth/documents'],
  drive: ['https://www.googleapis.com/auth/drive'],
  identity: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
}

function buildScopeString() {
  return [
    ...SCOPE_GROUPS.docs,
    ...SCOPE_GROUPS.drive,
    ...SCOPE_GROUPS.identity,
  ].join(' ')
}

// Workspace MIME for Google Docs.
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Export targets supported by Drive's files.export for Google Docs sources.
// Markdown export landed mid-2024 — verified working via the Docs UI menu.
const EXPORT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  html: 'text/html',
  zippedHtml: 'application/zip',
  epub: 'application/epub+zip',
  markdown: 'text/markdown',
}

// Default Drive list field set — small, only what we surface in dictionaries / lists.
const DOC_FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'description',
  'starred',
  'trashed',
  'parents',
  'owners',
  'lastModifyingUser',
  'createdTime',
  'modifiedTime',
  'webViewLink',
  'iconLink',
  'shared',
  'size',
].join(',')

const DOC_FILE_FIELDS_LIST = `nextPageToken,files(${ DOC_FILE_FIELDS })`

// Document body element types we surface for navigation (named ranges, headings, tables, images).
const HEADING_NAMED_STYLES = [
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'HEADING_4',
  'HEADING_5',
  'HEADING_6',
  'TITLE',
  'SUBTITLE',
]

const PARAGRAPH_NAMED_STYLES = [
  'NORMAL_TEXT',
  'TITLE',
  'SUBTITLE',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'HEADING_4',
  'HEADING_5',
  'HEADING_6',
]

// Max requests per documents.batchUpdate call. Past ~500 you hit per-call payload limits.
// We chunk above this when callers pass huge batches.
const MAX_BATCH_REQUESTS = 500

module.exports = {
  DOCS_API_BASE_URL,
  DRIVE_API_BASE_URL,
  DRIVE_UPLOAD_BASE_URL,
  TOKEN_URL,
  OAUTH_URL,
  USER_INFO_URL,
  REVOKE_URL,
  DEFAULT_PAGE_SIZE,
  MAX_DICTIONARY_PAGE_SIZE,
  MAX_LIST_PAGE_SIZE,
  SCOPE_GROUPS,
  buildScopeString,
  GOOGLE_DOC_MIME,
  FOLDER_MIME,
  EXPORT_MIME,
  DOC_FILE_FIELDS,
  DOC_FILE_FIELDS_LIST,
  HEADING_NAMED_STYLES,
  PARAGRAPH_NAMED_STYLES,
  MAX_BATCH_REQUESTS,
}
