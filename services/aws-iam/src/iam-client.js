'use strict'

const { signRequest } = require('./sigv4')
const { httpRequest, stsAssumeRole } = require('./aws-client')

const IAM_ENDPOINT = 'https://iam.amazonaws.com/'
const IAM_API_VERSION = '2010-05-08'
// IAM is a global service. The endpoint is always iam.amazonaws.com and the
// SigV4 signing region is ALWAYS us-east-1, regardless of the configured region.
const IAM_SIGNING_REGION = 'us-east-1'
const IAM_SERVICE = 'iam'

/**
 * Flattens an arbitrarily nested params object into AWS Query member syntax.
 * - Scalars become `Key=value`.
 * - Arrays become `Key.member.1=...&Key.member.2=...`. Array elements may be
 *   plain scalars or objects (e.g. Tags), which recurse with a `.N` index.
 * - Nested objects become `Key.SubKey=...`.
 * Undefined / null values are skipped.
 *
 * @param {Object} params
 * @returns {Array<[string, string]>} ordered list of [key, value] pairs
 */
function flattenQueryParams(params) {
  const pairs = []

  const walk = (prefix, value) => {
    if (value === undefined || value === null) {
      return
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(`${ prefix }.member.${ index + 1 }`, item)
      })

      return
    }

    if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        walk(`${ prefix }.${ key }`, value[key])
      }

      return
    }

    pairs.push([prefix, String(value)])
  }

  for (const key of Object.keys(params || {})) {
    walk(key, params[key])
  }

  return pairs
}

/**
 * Builds an application/x-www-form-urlencoded body for an AWS Query request.
 * Prepends Action and Version, then flattens all supplied params.
 *
 * @param {string} action - IAM action name (e.g. ListUsers)
 * @param {Object} params - operation-specific parameters
 * @returns {string} form-encoded body
 */
function buildQuery(action, params) {
  const pairs = [
    ['Action', action],
    ['Version', IAM_API_VERSION],
    ...flattenQueryParams(params),
  ]

  return pairs
    .map(([key, value]) => `${ encodeURIComponent(key) }=${ encodeURIComponent(value) }`)
    .join('&')
}

/**
 * Extracts the text of the first <tagName>...</tagName> occurrence.
 * Handles both `<Tag>value</Tag>` and self-closing / empty tags.
 *
 * @param {string} xml
 * @param {string} tagName
 * @returns {string|null}
 */
function parseXmlTag(xml, tagName) {
  if (!xml) {
    return null
  }

  const re = new RegExp('<' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tagName + '>')
  const match = xml.match(re)

  return match ? match[1] : null
}

/**
 * Extracts the text content of ALL <tagName>...</tagName> occurrences.
 *
 * @param {string} xml
 * @param {string} tagName
 * @returns {string[]}
 */
function parseXmlBlocks(xml, tagName) {
  if (!xml) {
    return []
  }

  const re = new RegExp('<' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tagName + '>', 'g')
  const results = []
  let match

  while ((match = re.exec(xml)) !== null) {
    results.push(match[1])
  }

  return results
}

/**
 * Decodes the common XML entities found in IAM responses (ARNs, policy docs,
 * paths). IAM XML-encodes embedded JSON policy documents.
 *
 * @param {string|null} value
 * @returns {string|null}
 */
function decodeXmlEntities(value) {
  if (value === null || value === undefined) {
    return value
  }

  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Convenience: extract a tag and decode its entities.
 *
 * @param {string} xml
 * @param {string} tagName
 * @returns {string|null}
 */
function getTag(xml, tagName) {
  return decodeXmlEntities(parseXmlTag(xml, tagName))
}

/**
 * Signs and sends an IAM AWS Query request, returning the raw response body XML.
 * On a non-2xx status it extracts <Error><Code>/<Message> and throws a rich Error.
 *
 * @param {string} action - IAM action name
 * @param {Object} params - operation params (flattened to Query syntax)
 * @param {Object} credentials - { accessKeyId, secretAccessKey, sessionToken? }
 * @returns {Promise<string>} response body XML
 */
async function iamRequest(action, params, credentials) {
  const body = buildQuery(action, params)
  const headers = { 'content-type': 'application/x-www-form-urlencoded' }

  signRequest('POST', IAM_ENDPOINT, headers, body, credentials, IAM_SIGNING_REGION, IAM_SERVICE)

  const response = await httpRequest('POST', IAM_ENDPOINT, headers, body)

  if (response.statusCode >= 300) {
    // IAM error XML: <ErrorResponse><Error><Code>..</Code><Message>..</Message></Error></ErrorResponse>
    const code = parseXmlTag(response.body, 'Code')
    const message = getTag(response.body, 'Message')
    const err = new Error(message || `IAM request failed with status ${ response.statusCode }`)

    err.name = code || 'IAMError'
    err.code = code
    err.statusCode = response.statusCode

    throw err
  }

  return response.body
}

module.exports = {
  IAM_ENDPOINT,
  IAM_API_VERSION,
  IAM_SIGNING_REGION,
  IAM_SERVICE,
  flattenQueryParams,
  buildQuery,
  parseXmlTag,
  parseXmlBlocks,
  decodeXmlEntities,
  getTag,
  iamRequest,
  stsAssumeRole,
}
