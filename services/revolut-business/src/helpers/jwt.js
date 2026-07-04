const crypto = require('crypto')

// Revolut Business uses RFC 7523 JWT bearer client assertion.
// Token endpoint accepts a JWT signed with the application's private key,
// the matching public key is registered with Revolut via the Business
// portal "Set up an API certificate" step.
//
// Required claims:
//   iss — host of the redirect URI registered with Revolut (e.g. 'your-flowrunner-host.com')
//   sub — your application's Client ID
//   aud — 'https://revolut.com'
//   exp — expiration timestamp (max 1 hour into the future)
//   iat — issued-at timestamp
//   jti — unique token identifier (nonce, recommended)
//
// Algorithm: RS256. Private key is supplied as a PEM string in the service config.

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)

  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function signClientAssertion({
  clientId,
  issuer,
  privateKey,
  lifetimeSeconds = 600,
}) {
  if (!clientId) {
    throw new Error(
      'Cannot sign Revolut client assertion: Client ID is missing from service configuration.'
    )
  }

  if (!issuer) {
    throw new Error(
      'Cannot sign Revolut client assertion: JWT Issuer host is missing from service configuration. ' +
        'Set it to the host of the redirect URI you registered in your Revolut Business application.'
    )
  }

  if (!privateKey) {
    throw new Error(
      'Cannot sign Revolut client assertion: Private Key is missing from service configuration.'
    )
  }

  const now = Math.floor(Date.now() / 1000)

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  }

  const payload = {
    iss: issuer,
    sub: clientId,
    aud: 'https://revolut.com',
    iat: now,
    exp: now + lifetimeSeconds,
    jti: crypto.randomBytes(16).toString('hex'),
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${ encodedHeader }.${ encodedPayload }`

  const normalizedKey = normalizePrivateKey(privateKey)

  const signer = crypto.createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()

  const signature = signer.sign(normalizedKey)
  const encodedSignature = base64UrlEncode(signature)

  return `${ signingInput }.${ encodedSignature }`
}

function normalizePrivateKey(rawKey) {
  // Users frequently paste PEM with escaped newlines from .env files or
  // mangled whitespace from the config UI. Restore the canonical format.
  let key = String(rawKey).trim()

  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n')
  }

  if (key.includes('-----BEGIN') && !key.includes('\n')) {
    key = key
      .replace(/-----BEGIN ([^-]+)-----/, '-----BEGIN $1-----\n')
      .replace(/-----END ([^-]+)-----/, '\n-----END $1-----')
  }

  return key
}

module.exports = {
  signClientAssertion,
}
