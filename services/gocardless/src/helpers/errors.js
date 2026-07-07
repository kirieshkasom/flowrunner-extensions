'use strict'

// GoCardless error envelope: `{ error: { type, code, message, errors: [{ reason, field, message }], request_id } }`.
// Map the `type` (or HTTP status when body is empty) to an operator-grep'able prefix + hint.
const GC_TYPE_PREFIX = {
  validation_failed: '[GoCardless][validation-failed]',
  invalid_api_usage: '[GoCardless][invalid-request]',
  invalid_state: '[GoCardless][invalid-state]',
  gocardless: '[GoCardless][upstream]',
}

const GC_REASON_PREFIX = {
  idempotent_creation_conflict: '[GoCardless][idempotent-replay]',
  bank_account_disabled: '[GoCardless][bank-account-disabled]',
  customer_bank_account_disabled: '[GoCardless][bank-account-disabled]',
  mandate_cancelled: '[GoCardless][mandate-cancelled]',
  mandate_failed: '[GoCardless][mandate-failed]',
  mandate_expired: '[GoCardless][mandate-expired]',
  mandate_blocked: '[GoCardless][mandate-blocked]',
  payment_cancelled: '[GoCardless][payment-cancelled]',
  payment_already_charged_back: '[GoCardless][payment-charged-back]',
  retry_outside_window: '[GoCardless][retry-window-closed]',
  cannot_change_currency: '[GoCardless][currency-locked]',
  scheme_not_supported_for_currency: '[GoCardless][unsupported-scheme]',
  bank_account_exists: '[GoCardless][bank-account-exists]',
  customer_already_removed: '[GoCardless][customer-removed]',
}

const GC_REASON_HINT = {
  idempotent_creation_conflict:
    'GoCardless found an existing resource matching this idempotency key and returned it. Inspect "links.conflicting_resource_id" to grab the original.',
  bank_account_disabled:
    'The customer_bank_account is disabled. Create a new bank account on the customer (disable is permanent).',
  mandate_cancelled:
    'The mandate has been cancelled. Some schemes (Bacs) allow reinstateMandate; others require a fresh authorisation.',
  mandate_failed:
    'The mandate failed authorisation. Collect a new mandate via createBillingRequestFlow.',
  mandate_expired:
    'The mandate expired (typically 13 months idle). Collect a new mandate via createBillingRequestFlow.',
  retry_outside_window:
    'GoCardless only allows retry for a limited window after failure (~21 days, scheme-dependent). Create a new payment instead.',
  scheme_not_supported_for_currency:
    'The currency you set is not supported by this scheme. Check SUPPORTED_CURRENCIES - e.g. USD only works with the ACH scheme.',
  customer_already_removed:
    'The customer has been soft-removed and is read-only. Create a new customer to take new mandates.',
  bank_account_exists:
    'A customer_bank_account with these details already exists. Reuse the existing record via links.conflicting_resource_id.',
}

function extractGoCardlessError(error) {
  const body = error?.body || error?.response?.body

  if (!body) return null

  const envelope = body.error || body

  if (!envelope) return null

  const errors = Array.isArray(envelope.errors) ? envelope.errors : []
  const first = errors[0] || null

  return {
    type: envelope.type,
    code: envelope.code,
    message: envelope.message,
    requestId: envelope.request_id,
    documentationUrl: envelope.documentation_url,
    reason: first?.reason,
    field: first?.field,
    fieldMessage: first?.message,
    conflictingResourceId: first?.links?.conflicting_resource_id,
    errors,
  }
}

// Compose `[prefix][logTag] <message> [request_id=...] [conflict=...] - <hint>`
function buildFriendlyMessage(error, logTag) {
  const httpStatus =
    error?.status || error?.statusCode || error?.response?.status
  const gc = extractGoCardlessError(error)

  let prefix = '[GoCardless]'

  if (gc?.reason && GC_REASON_PREFIX[gc.reason]) {
    prefix = GC_REASON_PREFIX[gc.reason]
  } else if (gc?.type && GC_TYPE_PREFIX[gc.type]) {
    prefix = GC_TYPE_PREFIX[gc.type]
  } else if (httpStatus === 401) {
    prefix = '[GoCardless][auth-failed]'
  } else if (httpStatus === 403) {
    prefix = '[GoCardless][forbidden]'
  } else if (httpStatus === 404) {
    prefix = '[GoCardless][not-found]'
  } else if (httpStatus === 409) {
    prefix = '[GoCardless][conflict]'
  } else if (httpStatus === 422) {
    prefix = '[GoCardless][validation-failed]'
  } else if (httpStatus === 429) {
    prefix = '[GoCardless][rate-limited]'
  } else if (httpStatus >= 500) {
    prefix = '[GoCardless][upstream]'
  }

  const message =
    gc?.fieldMessage || gc?.message || error?.message || 'Unknown error'

  const hint = gc?.reason ? GC_REASON_HINT[gc.reason] : null
  const reqIdTag = gc?.requestId ? ` request_id=${ gc.requestId }` : ''
  const fieldTag = gc?.field ? ` field=${ gc.field }` : ''
  const conflictTag = gc?.conflictingResourceId
    ? ` conflict=${ gc.conflictingResourceId }`
    : ''

  return `${ prefix }[${ logTag }] ${ message }${ fieldTag }${ reqIdTag }${ conflictTag }${ hint ? ` - ${ hint }` : '' }`
}

// GC returns 409 invalid_state with reason=idempotent_creation_conflict when the same
// Idempotency-Key was used before. The conflict carries the existing resource id; recovery is to
// GET that resource and surface it as the create result, so retries don't double-create and
// callers see the original record.
function isIdempotentReplay(error) {
  const gc = extractGoCardlessError(error)

  return (
    gc?.reason === 'idempotent_creation_conflict' && !!gc.conflictingResourceId
  )
}

function getConflictingResourceId(error) {
  return extractGoCardlessError(error)?.conflictingResourceId || null
}

module.exports = {
  buildFriendlyMessage,
  extractGoCardlessError,
  isIdempotentReplay,
  getConflictingResourceId,
}
