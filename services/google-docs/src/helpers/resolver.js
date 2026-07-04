'use strict'

// Google Doc IDs share the same alphabet/length characteristics as Drive IDs.
const DOC_ID_RAW = /^[A-Za-z0-9_-]{15,}$/

// https://docs.google.com/document/d/<id>/edit
// https://docs.google.com/document/u/0/d/<id>/edit
// https://docs.google.com/document/d/<id>/edit?tab=t.abcdef
const DOC_URL_RE = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/

// https://docs.google.com/document/d/<id>/edit#heading=h.abcdef
// or ?tab=t.abcdef → fragment after the doc ID is preserved on get/edit URLs.
const TAB_RE = /[?&#]tab=t\.([A-Za-z0-9_-]+)/

const FOLDER_URL_RE = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/

/**
 * Extracts a Google Doc ID from a doc URL, edit URL, copy URL, or bare ID.
 * Returns the input trimmed if it doesn't match a known pattern (so caller can let the API reject it).
 */
function extractDocId(input) {
  if (!input) return input

  const trimmed = String(input).trim()

  const m = trimmed.match(DOC_URL_RE)

  if (m) return m[1]

  if (DOC_ID_RAW.test(trimmed) && !/[\s/]/.test(trimmed)) return trimmed

  return trimmed
}

/**
 * Extracts a folder ID from a Drive folder URL or bare ID.
 */
function extractFolderId(input) {
  if (!input) return input

  const trimmed = String(input).trim()

  if (trimmed === 'root' || trimmed.toLowerCase() === 'my drive') return 'root'

  const m = trimmed.match(FOLDER_URL_RE)

  if (m) return m[1]

  return trimmed
}

/**
 * Tries to read the `?tab=t.<id>` fragment from a doc URL — used to scope index operations
 * to a specific tab inside a multi-tab document. Returns undefined when absent.
 */
function extractTabId(input) {
  if (!input) return undefined

  const m = String(input).match(TAB_RE)

  return m ? `t.${ m[1] }` : undefined
}

module.exports = { extractDocId, extractFolderId, extractTabId, DOC_ID_RAW }
