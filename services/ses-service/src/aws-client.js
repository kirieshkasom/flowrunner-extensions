'use strict'

const https = require('https')
const http = require('http')

const { signRequest } = require('./sigv4')

function httpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const transport = parsedUrl.protocol === 'https:' ? https : http

    const requestHeaders = { ...headers }

    if (body) {
      requestHeaders['content-length'] = Buffer.byteLength(body)
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: requestHeaders,
    }

    const req = transport.request(options, res => {
      const chunks = []

      res.on('error', err => reject(err))
      res.on('data', chunk => chunks.push(chunk))

      res.on('end', () => {
        const bodyString = Buffer.concat(chunks).toString('utf8')

        resolve({ statusCode: res.statusCode, headers: res.headers, body: bodyString })
      })
    })

    req.on('error', err => reject(err))

    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'))
    })

    if (body) {
      req.write(body)
    }

    req.end()
  })
}

function parseXmlTag(xml, tagName) {
  const re = new RegExp('<' + tagName + '>([\\s\\S]*?)</' + tagName + '>')
  const match = xml.match(re)

  return match ? match[1] : null
}

function parseXmlTags(xml, tagName) {
  const re = new RegExp('<' + tagName + '>([\\s\\S]*?)</' + tagName + '>', 'g')
  const results = []
  let match

  while ((match = re.exec(xml)) !== null) {
    results.push(match[1])
  }

  return results
}

async function stsAssumeRole(credentials, region, roleArn, sessionName, externalId) {
  let formBody =
    'Action=AssumeRole' +
    '&Version=2011-06-15' +
    `&RoleArn=${ encodeURIComponent(roleArn) }` +
    `&RoleSessionName=${ encodeURIComponent(sessionName) }`

  if (externalId) {
    formBody += `&ExternalId=${ encodeURIComponent(externalId) }`
  }

  const url = `https://sts.${ region }.amazonaws.com/`
  const headers = { 'content-type': 'application/x-www-form-urlencoded' }

  signRequest('POST', url, headers, formBody, credentials, region, 'sts')

  const response = await httpRequest('POST', url, headers, formBody)

  if (response.statusCode >= 300) {
    const code = parseXmlTag(response.body, 'Code')
    const message = parseXmlTag(response.body, 'Message')
    const err = new Error(message || 'STS AssumeRole failed')

    err.name = code || 'STSError'
    err.statusCode = response.statusCode

    throw err
  }

  const accessKeyId = parseXmlTag(response.body, 'AccessKeyId')
  const secretAccessKey = parseXmlTag(response.body, 'SecretAccessKey')
  const sessionToken = parseXmlTag(response.body, 'SessionToken')
  const expirationStr = parseXmlTag(response.body, 'Expiration')

  if (!accessKeyId || !secretAccessKey || !sessionToken || !expirationStr) {
    const err = new Error('Failed to parse STS AssumeRole response: missing credential fields')

    err.name = 'STSParseError'

    throw err
  }

  return { accessKeyId, secretAccessKey, sessionToken, expiration: new Date(expirationStr) }
}

function buildAwsJsonRequest({ region, service, target, body, contentType }) {
  const url = `https://${ service }.${ region }.amazonaws.com/`
  const serialized = typeof body === 'string' ? body : JSON.stringify(body || {})
  const headers = { 'content-type': contentType }

  if (target) {
    headers['x-amz-target'] = target
  }

  return { method: 'POST', url, headers, body: serialized }
}

function parseJsonResponse(response) {
  const text = (response.body || '').trim()
  const parsed = text ? JSON.parse(text) : {}

  if (response.statusCode >= 300) {
    const rawType = parsed.__type || parsed.code || ''
    const name = rawType.includes('#') ? rawType.split('#')[1] : rawType || 'AwsError'
    const message = parsed.message || parsed.Message || `Request failed with status ${ response.statusCode }`
    const err = new Error(message)

    err.name = name
    err.statusCode = response.statusCode

    throw err
  }

  return parsed
}

async function jsonRequest(opts, credentials, deps = {}) {
  const sign = deps.signRequest || signRequest
  const send = deps.httpRequest || httpRequest
  const built = buildAwsJsonRequest(opts)

  sign(built.method, built.url, built.headers, built.body, credentials, opts.region, opts.service)

  const response = await send(built.method, built.url, built.headers, built.body)

  return parseJsonResponse(response)
}

function buildRestJsonRequest({ region, service, method = 'POST', path = '/', body }) {
  const url = `https://${ service }.${ region }.amazonaws.com${ path }`
  const serialized = body === undefined || body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const headers = { 'content-type': 'application/json' }

  return { method, url, headers, body: serialized }
}

async function restJsonRequest(opts, credentials, deps = {}) {
  const sign = deps.signRequest || signRequest
  const send = deps.httpRequest || httpRequest
  const built = buildRestJsonRequest(opts)

  sign(built.method, built.url, built.headers, built.body, credentials, opts.region, opts.service)

  const response = await send(built.method, built.url, built.headers, built.body)

  return parseJsonResponse(response)
}

module.exports = {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
  buildRestJsonRequest,
  restJsonRequest,
}
