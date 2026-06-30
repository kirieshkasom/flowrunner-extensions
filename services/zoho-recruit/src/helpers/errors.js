'use strict'

// Recruit error codes → operator-grep'able prefix. Body code wins over HTTP status; HTTP fallback
// covers 401/403/404/429 from network/gateway errors that ship no JSON body.
const ZOHO_CODE_PREFIX = {
  // Auth
  INVALID_TOKEN: '[Zoho Recruit][auth-expired]',
  OAUTH_SCOPE_MISMATCH: '[Zoho Recruit][scope-mismatch]',
  AUTHORIZATION_FAILED: '[Zoho Recruit][auth-failed]',
  AUTHENTICATION_FAILURE: '[Zoho Recruit][auth-failed]',

  // Validation
  INVALID_DATA: '[Zoho Recruit][invalid-data]',
  INVALID_MODULE: '[Zoho Recruit][invalid-module]',
  INVALID_QUERY: '[Zoho Recruit][invalid-query]',
  MANDATORY_NOT_FOUND: '[Zoho Recruit][missing-required-field]',
  DUPLICATE_DATA: '[Zoho Recruit][duplicate]',
  INVALID_REQUEST_METHOD: '[Zoho Recruit][bad-request]',
  INVALID_URL_PATTERN: '[Zoho Recruit][bad-url]',
  PATTERN_NOT_MATCHED: '[Zoho Recruit][invalid-format]',

  // Records
  RECORD_NOT_FOUND: '[Zoho Recruit][not-found]',
  NOT_FOUND: '[Zoho Recruit][not-found]',
  CANNOT_PROCESS_REQUEST: '[Zoho Recruit][cannot-process]',
  NOT_ALLOWED: '[Zoho Recruit][forbidden]',
  NO_PERMISSION: '[Zoho Recruit][forbidden]',

  // Limits
  LIMIT_EXCEEDED: '[Zoho Recruit][rate-limited]',
  TOO_MANY_REQUESTS: '[Zoho Recruit][rate-limited]',
  CONCURRENT_LIMIT: '[Zoho Recruit][rate-limited:concurrent]',

  // Notifications
  ALREADY_ENABLED: '[Zoho Recruit][notification-already-enabled]',
  CHANNEL_EXPIRED: '[Zoho Recruit][notification-channel-expired]',
}

const ZOHO_CODE_HINT = {
  INVALID_TOKEN:
    'Access token expired or revoked — Flowrunner will refresh automatically and retry.',
  OAUTH_SCOPE_MISMATCH:
    'The connected account does not include the scope required by this action. Reconnect with the correct scopes.',
  MANDATORY_NOT_FOUND:
    'A field marked mandatory in the Zoho Recruit layout was not provided.',
  DUPLICATE_DATA:
    'Record violates a unique-field constraint (typically Email or Phone). Use upsertRecord with duplicate_check_fields if you want overwrite-on-conflict.',
  RECORD_NOT_FOUND:
    'No record with that ID exists in this module — it may have been deleted or the module name is wrong.',
  LIMIT_EXCEEDED:
    'You exhausted the daily API credit pool for this Zoho Recruit org. Quota resets in 24 hours.',
  TOO_MANY_REQUESTS:
    'Per-minute rate limit hit — slow down and retry after a few seconds.',
  CONCURRENT_LIMIT:
    'Too many simultaneous calls in flight against the Zoho org — reduce parallelism.',
  CHANNEL_EXPIRED:
    'The notification channel expired before refresh. The trigger will re-subscribe on next upsert.',
  INVALID_QUERY:
    'Search criteria parsing failed — check field api_names, operators, and that values with parens/commas are escaped.',
}

function extractZohoError(error) {
  const body = error?.body

  // Per-record errors come back as `{ data: [{ status:'error', code, message, details }] }` even
  // when the HTTP response is 200. Surface the first failing row.
  if (body?.data && Array.isArray(body.data)) {
    const failedRow = body.data.find(row => row?.status === 'error')

    if (failedRow) {
      return {
        code: failedRow.code,
        message: failedRow.message,
        details: failedRow.details,
      }
    }
  }

  if (body?.code) {
    return {
      code: body.code,
      message: body.message,
      details: body.details,
    }
  }

  return null
}

// Compose the user-visible error: `[prefix][logTag] message [details=...] [— hint]`.
function buildFriendlyMessage(error, logTag) {
  const httpStatus = error?.status || error?.statusCode
  const zohoErr = extractZohoError(error)

  let prefix = '[Zoho Recruit]'
  const message =
    zohoErr?.message ||
    error?.body?.message ||
    error?.message ||
    'Unknown error'

  if (zohoErr?.code && ZOHO_CODE_PREFIX[zohoErr.code]) {
    prefix = ZOHO_CODE_PREFIX[zohoErr.code]
  } else if (httpStatus === 401) {
    prefix = ZOHO_CODE_PREFIX.INVALID_TOKEN
  } else if (httpStatus === 429) {
    prefix = ZOHO_CODE_PREFIX.LIMIT_EXCEEDED
  } else if (httpStatus === 404) {
    prefix = ZOHO_CODE_PREFIX.RECORD_NOT_FOUND
  } else if (httpStatus === 403) {
    prefix = ZOHO_CODE_PREFIX.NOT_ALLOWED
  }

  const hint = zohoErr?.code ? ZOHO_CODE_HINT[zohoErr.code] : null
  const details = zohoErr?.details
    ? ` details=${ JSON.stringify(zohoErr.details) }`
    : ''

  return `${ prefix }[${ logTag }] ${ message }${ details }${ hint ? ` — ${ hint }` : '' }`
}

module.exports = {
  buildFriendlyMessage,
  extractZohoError,
}
