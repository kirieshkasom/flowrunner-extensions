const crypto = require('crypto')

// Revolut Business signs each webhook with HMAC-SHA256 using the signing
// secret returned from POST /webhooks. The signature header has the form:
//   Revolut-Signature: v1=<hex>,v1=<hex>
// The signed payload concatenates "v1." + timestamp + "." + raw_body.

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

function verifyWebhookSignature({
  rawBody,
  signatureHeader,
  timestampHeader,
  signingSecret,
}) {
  if (!signingSecret) {
    return { valid: false, reason: 'missing-signing-secret' }
  }

  if (!signatureHeader || !timestampHeader) {
    return { valid: false, reason: 'missing-headers' }
  }

  const ageSeconds = Math.abs(
    Math.floor(Date.now() / 1000) - Number(timestampHeader)
  )

  if (
    !Number.isFinite(ageSeconds) ||
    ageSeconds > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return { valid: false, reason: 'timestamp-out-of-tolerance' }
  }

  const signedPayload = `v1.${ timestampHeader }.${ rawBody }`
  const expected = crypto
    .createHmac('sha256', signingSecret)
    .update(signedPayload)
    .digest('hex')

  const signatures = signatureHeader
    .split(',')
    .map(part => part.trim())
    .filter(part => part.startsWith('v1='))
    .map(part => part.slice(3))

  const valid = signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig, 'hex'),
        Buffer.from(expected, 'hex')
      )
    } catch {
      return false
    }
  })

  return { valid, reason: valid ? null : 'signature-mismatch' }
}

// Reconstruct the raw request body from an invocation for HMAC verification.
// Prefer the exact bytes Revolut signed (rawBody); fall back to a stringified
// parsed body only when that is all the harness provides.
function rawBodyOf(invocation) {
  if (!invocation) {
    return ''
  }

  if (typeof invocation.rawBody === 'string') {
    return invocation.rawBody
  }

  if (Buffer.isBuffer(invocation.rawBody)) {
    return invocation.rawBody.toString('utf8')
  }

  if (typeof invocation.body === 'string') {
    return invocation.body
  }

  if (invocation.body && typeof invocation.body === 'object') {
    return JSON.stringify(invocation.body)
  }

  return ''
}

// Return the invocation headers with lower-cased keys so callers can read a
// header by its canonical lower-case name regardless of how it was sent.
function headersOf(invocation) {
  const headers = invocation?.headers || invocation?.queryParams?.headers || {}
  const out = {}

  for (const [key, value] of Object.entries(headers)) {
    out[String(key).toLowerCase()] = value
  }

  return out
}

module.exports = {
  verifyWebhookSignature,
  rawBodyOf,
  headersOf,
}
