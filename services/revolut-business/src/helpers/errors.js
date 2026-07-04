const { logger } = require('./logger')

// Friendly messages mapped from Revolut API error patterns.
// Revolut returns either { message, code } or { error, error_description }
// for OAuth failures. Map known cases to actionable hints so operators
// understand permission / setup gaps.
const FRIENDLY_HINTS = [
  {
    match: /insufficient.*funds|insufficient.*balance/i,
    hint: 'Source account does not have sufficient available balance for this transfer.',
  },
  {
    match: /counterparty.*not.*found|invalid.*counterparty/i,
    hint: 'The counterparty does not exist in your account. Create the counterparty first using Create Counterparty.',
  },
  {
    match: /currency.*not.*supported|unsupported.*currency/i,
    hint: 'The selected currency is not supported by this account. Verify the account currency or use Exchange Money first.',
  },
  {
    match: /invalid.*scope|missing.*scope|scope.*denied/i,
    hint: 'Your Revolut Business application does not have permission for this operation. Re-authorise with the required scope (READ, WRITE, PAY).',
  },
  {
    match: /invalid_grant|expired.*token|token.*expired/i,
    hint: 'The OAuth grant is no longer valid. Reconnect the Revolut Business account.',
  },
  {
    match: /invalid_client/i,
    hint: 'The client_id or signed JWT is rejected. Verify the Client ID, JWT Issuer host and Private Key in the service configuration.',
  },
  {
    match: /rate.*limit|too.*many.*requests/i,
    hint: 'Revolut Business API rate limit hit. Reduce request frequency and retry with exponential backoff.',
  },
  {
    match: /two.factor|2fa|sca|strong.*customer.*authentication/i,
    hint: 'Strong Customer Authentication is required. Approve the transaction in the Revolut Business mobile app, then retry.',
  },
  {
    match: /freelancer|business.*plan|not.*permitted.*for.*your.*plan/i,
    hint: 'This endpoint is restricted to Revolut Business Company plans. Use Create Payment Draft instead of Make Payment.',
  },
]

function extractApiError(error) {
  const body = error?.body || error?.message || error
  let parsed = body

  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = { message: body }
    }
  }

  const message =
    parsed?.message ||
    parsed?.error_description ||
    parsed?.error ||
    error?.message ||
    'Unknown Revolut Business API error'

  const code =
    parsed?.code || parsed?.error || error?.status || error?.statusCode

  return { message: String(message), code, raw: parsed }
}

function wrapApiError(error, logTag) {
  const { message, code, raw } = extractApiError(error)

  const friendly = FRIENDLY_HINTS.find(entry =>
    entry.match.test(message)
  )?.hint

  const wrapped = new Error(friendly ? `${ message } — ${ friendly }` : message)

  wrapped.status = error?.status || error?.statusCode
  wrapped.code = code
  wrapped.tag = logTag
  wrapped.raw = raw

  logger.error(
    `[${ logTag }] Revolut API error (${ wrapped.status || 'n/a' } ${ code || '' }): ${ wrapped.message }`
  )

  return wrapped
}

module.exports = {
  extractApiError,
  wrapApiError,
}
