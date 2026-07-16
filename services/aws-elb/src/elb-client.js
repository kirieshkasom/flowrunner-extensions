'use strict'

const { signRequest } = require('./sigv4')
const { httpRequest, parseXmlTag } = require('./aws-client')
const { parseXml } = require('./xml')

const API_VERSION = '2015-12-01'
const SERVICE = 'elasticloadbalancing'

/**
 * Form-encodes an AWS Query request body.
 *
 * Accepts a flat map whose values are strings/numbers/booleans, arrays (of the
 * above, or of plain objects), and plain objects. Arrays are flattened as
 * `Key.member.1`, `Key.member.2`, ...; object entries in an array flatten as
 * `Key.member.1.Field`; nested plain objects flatten as `Key.Field`. Undefined
 * / null values are skipped.
 *
 * @param {string} action - The ELB Action name (e.g. 'DescribeLoadBalancers').
 * @param {Object} params - Flat parameter map.
 * @returns {string} application/x-www-form-urlencoded body.
 */
function buildQuery(action, params = {}) {
  const pairs = []

  const encode = value => encodeURIComponent(String(value))

  const add = (key, value) => {
    if (value === undefined || value === null) return

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const memberKey = `${ key }.member.${ i + 1 }`

        if (item !== null && typeof item === 'object') {
          Object.keys(item).forEach(field => add(`${ memberKey }.${ field }`, item[field]))
        } else {
          add(memberKey, item)
        }
      })

      return
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(field => add(`${ key }.${ field }`, value[field]))

      return
    }

    pairs.push(`${ encode(key) }=${ encode(value) }`)
  }

  add('Action', action)
  add('Version', API_VERSION)

  Object.keys(params).forEach(key => add(key, params[key]))

  return pairs.join('&')
}

/**
 * Signs and sends an ELB Query request, returning the parsed XML result body.
 *
 * On a non-2xx response the XML <Error><Code>/<Message> is extracted and thrown
 * as an Error whose `name` is the ELB error Code and `statusCode` is the HTTP
 * status, so callers can map ELB-specific failures cleanly.
 *
 * @param {string} action - ELB Action name.
 * @param {Object} params - Query parameters (see buildQuery).
 * @param {Object} credentials - { accessKeyId, secretAccessKey, sessionToken? }.
 * @param {string} region - AWS region code.
 * @returns {Promise<Object>} Parsed XML document as a plain JS object.
 */
async function elbRequest(action, params, credentials, region) {
  const url = `https://${ SERVICE }.${ region }.amazonaws.com/`
  const body = buildQuery(action, params)
  const headers = { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }

  signRequest('POST', url, headers, body, credentials, region, SERVICE)

  const response = await httpRequest('POST', url, headers, body)

  if (response.statusCode >= 300) {
    const code = parseXmlTag(response.body, 'Code')
    const message = parseXmlTag(response.body, 'Message')
    const err = new Error(message || `ELB request failed with status ${ response.statusCode }`)

    err.name = code || 'ELBError'
    err.statusCode = response.statusCode

    throw err
  }

  return parseXml(response.body)
}

module.exports = { buildQuery, elbRequest, API_VERSION, SERVICE }
