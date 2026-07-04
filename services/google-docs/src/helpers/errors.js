'use strict'

const FRIENDLY_ERROR_MESSAGES = {
  // Auth / quota
  authError: 'Google authentication failed. Reconnect the integration.',
  invalidCredentials: 'Google credentials are invalid. Reconnect the integration.',
  quotaExceeded: 'Daily Docs/Drive API quota exceeded. Increase quota in Google Cloud Console (APIs & Services > Quotas) or wait until reset.',
  rateLimitExceeded: 'Google is rate-limiting these requests. Slow down and retry shortly.',
  userRateLimitExceeded: 'Too many requests too fast. Slow down and retry.',
  insufficientPermissions: 'The connected account lacks the required Docs/Drive scope. Reconnect to add scopes.',
  insufficientFilePermissions: 'You do not have edit access to this document. Ask the owner to share it with you (Editor role).',
  forbidden: 'Access denied. The document is restricted or the account lacks the required scope.',

  // Resource not found
  notFound: 'Document not found. Check the document ID and that the connected account has access.',
  documentNotFound: 'Document not found. Check the document ID and that the connected account has access.',
  folderNotFound: 'Folder not found. Check the folder ID and that the connected account has access.',

  // Validation / batchUpdate
  invalid: 'A request parameter has an invalid value. Check the input.',
  invalidParameter: 'Invalid parameter value. Review the field requirements.',
  invalidArgument: 'Invalid argument for one of the batchUpdate requests. Common cause: index out of range, or attempting to delete a structural newline.',
  invalidRange: 'Invalid index range. Indices must be ≥ 1 and reference characters present in the document. Reload the document and recompute indices.',
  failedPrecondition: 'Request preconditions failed. Common causes: editing a tab that no longer exists, or operating on a deleted element.',
  badRequest: 'Request was rejected by Google. Check parameter values.',
  outOfRange: 'Index is outside the document. Most Docs operations require indices ≥ 1 — the first character is at index 1.',

  // Conflict
  alreadyExists: 'A resource with the same identifier already exists (e.g. a named range with this name).',
  conflict: 'Concurrent edit detected. Reload the document and try again.',

  // Export
  exportSizeLimitExceeded: 'Document is too large to export (10 MB cap). Try a different format or split the document.',

  // Service
  internalError: 'Google returned an internal error. Retry shortly.',
  backendError: 'Google backend is unavailable. Retry shortly.',
}

function friendlyMessage(reason, fallback) {
  return FRIENDLY_ERROR_MESSAGES[reason] || fallback
}

/**
 * Pulls reason + message from a Flowrunner.Request error body.
 * Google APIs return: { error: { code, message, status, errors: [{ reason, message }] } }
 * Some Docs batchUpdate errors only set top-level `status` (e.g. INVALID_ARGUMENT).
 */
function extractApiError(error) {
  const apiError = error?.body?.error || error?.response?.error || error?.body?.error_description

  if (!apiError) return null

  if (typeof apiError === 'string') {
    return `Google Docs: ${ apiError }`
  }

  const reason =
    apiError.errors?.[0]?.reason ||
    (apiError.status ? toCamelCase(apiError.status) : null)

  const original = apiError.message || ''
  const friendly = friendlyMessage(reason, null)

  if (friendly) {
    return reason ? `${ friendly } (${ reason })` : friendly
  }

  if (original) {
    return reason ? `Google Docs: ${ original } (${ reason })` : `Google Docs: ${ original }`
  }

  return null
}

function toCamelCase(s) {
  return String(s).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

module.exports = { FRIENDLY_ERROR_MESSAGES, friendlyMessage, extractApiError }
