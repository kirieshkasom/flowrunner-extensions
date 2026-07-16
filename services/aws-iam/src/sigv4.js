'use strict'

const crypto = require('crypto')

/**
 * Returns hex-encoded SHA256 hash of the given data.
 * @param {string|Buffer} data
 * @returns {string}
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Returns raw Buffer HMAC-SHA256.
 * @param {Buffer|string} key
 * @param {string} data
 * @returns {Buffer}
 */
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

/**
 * Percent-encodes a string per AWS rules.
 * Encodes everything except A-Z a-z 0-9 - . _ ~
 * If encodeSlash is true (default), encodes '/' as well.
 * Space becomes %20 (not +). Hex digits are uppercase.
 * @param {string} str
 * @param {boolean} [encodeSlash=true]
 * @returns {string}
 */
function uriEncode(str, encodeSlash = true) {
  let result = ''

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]

    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '-' ||
      ch === '.' ||
      ch === '_' ||
      ch === '~'
    ) {
      result += ch
    } else if (ch === '/' && !encodeSlash) {
      result += ch
    } else {
      const code = ch.charCodeAt(0)

      if (code <= 0x7f) {
        result += '%' + code.toString(16).toUpperCase().padStart(2, '0')
      } else {
        // For multi-byte UTF-8 characters, encode each byte
        const encoded = Buffer.from(ch, 'utf8')

        for (let j = 0; j < encoded.length; j++) {
          result += '%' + encoded[j].toString(16).toUpperCase().padStart(2, '0')
        }
      }
    }
  }

  return result
}

/**
 * Derives the signing key for AWS SigV4.
 * @param {string} secretKey
 * @param {string} dateStamp - YYYYMMDD format
 * @param {string} region
 * @param {string} service
 * @returns {Buffer}
 */
function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmacSha256('AWS4' + secretKey, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'aws4_request')

  return kSigning
}

/**
 * Formats a Date as AMZ date string: YYYYMMDD'T'HHmmss'Z'
 * @param {Date} date
 * @returns {string}
 */
function formatAmzDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Formats a Date as date stamp: YYYYMMDD
 * @param {Date} date
 * @returns {string}
 */
function formatDateStamp(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Signs an HTTP request using AWS Signature Version 4.
 * Mutates the headers object to add authorization headers.
 *
 * @param {string} method - HTTP method (GET, PUT, DELETE, HEAD, POST)
 * @param {string} url - Full URL string
 * @param {Object} headers - Request headers (will be mutated)
 * @param {string|Buffer} body - Request body or empty string
 * @param {Object} credentials - { accessKeyId, secretAccessKey, sessionToken? }
 * @param {string} region - AWS region
 * @param {string} service - AWS service name (s3, sts)
 * @returns {Object} The mutated headers object
 */
function signRequest(method, url, headers, body, credentials, region, service) {
  const parsedUrl = new URL(url)
  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = formatDateStamp(now)

  // Set required headers
  headers['x-amz-date'] = amzDate
  headers['x-amz-content-sha256'] = sha256(body || '')

  if (credentials.sessionToken) {
    headers['x-amz-security-token'] = credentials.sessionToken
  }

  // Ensure host header is set (case-insensitive check)
  const existingHostKey = Object.keys(headers).find(k => k.toLowerCase() === 'host')

  if (!existingHostKey) {
    const isNonStandardPort =
      parsedUrl.port &&
      parsedUrl.port !== '443' &&
      parsedUrl.port !== '80'

    headers['host'] = isNonStandardPort
      ? `${ parsedUrl.hostname }:${ parsedUrl.port }`
      : parsedUrl.hostname
  }

  // Build canonical headers (sorted by lowercase name)
  const sortedHeaderKeys = Object.keys(headers)
    .map(k => k.toLowerCase())
    .sort()

  const canonicalHeaders = sortedHeaderKeys
    .map(key => {
      const value = headers[Object.keys(headers).find(k => k.toLowerCase() === key)]

      return `${ key }:${ String(value).trim() }\n`
    })
    .join('')

  const signedHeaders = sortedHeaderKeys.join(';')

  // Build canonical query string
  const params = Array.from(parsedUrl.searchParams.entries())

  params.sort((a, b) => {
    if (a[0] < b[0]) return -1
    if (a[0] > b[0]) return 1

    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
  })

  const canonicalQueryString = params
    .map(([key, value]) => `${ uriEncode(key) }=${ uriEncode(value) }`)
    .join('&')

  // Build canonical URI - decode each segment first (undo URL constructor encoding),
  // then re-encode with SigV4-compliant uriEncode (encodeSlash=false to preserve separators)
  const canonicalUri = '/' + parsedUrl.pathname.slice(1).split('/').map(segment => uriEncode(decodeURIComponent(segment))).join('/') || '/'

  // Payload hash
  const payloadHash = headers['x-amz-content-sha256']

  // Build canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  // Build string to sign
  const credentialScope = `${ dateStamp }/${ region }/${ service }/aws4_request`

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')

  // Derive signing key and calculate signature
  const signingKey = getSigningKey(credentials.secretAccessKey, dateStamp, region, service)
  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  // Set authorization header
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ credentialScope }, ` +
    `SignedHeaders=${ signedHeaders }, ` +
    `Signature=${ signature }`

  return headers
}

/**
 * Generates a presigned URL using AWS Signature Version 4 query string auth.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Full URL string
 * @param {Object} credentials - { accessKeyId, secretAccessKey, sessionToken? }
 * @param {string} region - AWS region
 * @param {string} service - AWS service name (s3, sts)
 * @param {number} expiresIn - Expiration time in seconds
 * @returns {string} The full presigned URL string
 */
function generatePresignedUrl(method, url, credentials, region, service, expiresIn) {
  const parsedUrl = new URL(url)
  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = formatDateStamp(now)

  // Build credential scope
  const credentialScope = `${ credentials.accessKeyId }/${ dateStamp }/${ region }/${ service }/aws4_request`

  // Add SigV4 query parameters
  parsedUrl.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  parsedUrl.searchParams.set('X-Amz-Credential', credentialScope)
  parsedUrl.searchParams.set('X-Amz-Date', amzDate)
  parsedUrl.searchParams.set('X-Amz-Expires', String(expiresIn))
  parsedUrl.searchParams.set('X-Amz-SignedHeaders', 'host')

  if (credentials.sessionToken) {
    parsedUrl.searchParams.set('X-Amz-Security-Token', credentials.sessionToken)
  }

  // Host header for canonical request
  const isNonStandardPort =
    parsedUrl.port &&
    parsedUrl.port !== '443' &&
    parsedUrl.port !== '80'

  const hostValue = isNonStandardPort
    ? `${ parsedUrl.hostname }:${ parsedUrl.port }`
    : parsedUrl.hostname

  // Build canonical query string from the URL's search params (sorted)
  const params = Array.from(parsedUrl.searchParams.entries())

  params.sort((a, b) => {
    if (a[0] < b[0]) return -1
    if (a[0] > b[0]) return 1

    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
  })

  const canonicalQueryString = params
    .map(([key, value]) => `${ uriEncode(key) }=${ uriEncode(value) }`)
    .join('&')

  // Canonical URI - decode each segment first, then re-encode with SigV4-compliant uriEncode
  const canonicalUri = '/' + parsedUrl.pathname.slice(1).split('/').map(segment => uriEncode(decodeURIComponent(segment))).join('/') || '/'

  // Canonical headers (only host for presigned URLs)
  const canonicalHeaders = `host:${ hostValue }\n`
  const signedHeaders = 'host'

  // Build canonical request with UNSIGNED-PAYLOAD
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  // Build string to sign
  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n')

  // Derive signing key and calculate signature
  const signingKey = getSigningKey(credentials.secretAccessKey, dateStamp, region, service)
  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  // Append signature to URL
  parsedUrl.searchParams.set('X-Amz-Signature', signature)

  return parsedUrl.toString()
}

module.exports = {
  signRequest,
  generatePresignedUrl,
}
